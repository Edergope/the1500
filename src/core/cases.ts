import {adminEvent,AdminError,decideReactivation,requireEvidence,revokeFounderAward} from './admin';
import {IdentityError} from './identity';
import {notifyOwners,openIncident,startFinalNoticeClock} from './ops';
import {requestRefund} from './payments';
import type {StripeEnv} from './stripe';
import {caseResolutionEmail,finalNoticeEmail} from '../lib/i18n/comms';

interface CaseRow {company_id:string;origin:string;status:string;final_notice_requested_at:string|null;final_notice_sent_at:string|null;final_notice_due_at:string|null;final_notice_response_at:string|null;reactivation_notified_at:string|null;resolved_at:string|null;}
const getCase=async(db:D1Database,companyId:string)=>{
  const row=await db.prepare(`SELECT * FROM onboarding_cases WHERE company_id=?`).bind(companyId).first<CaseRow>();
  if (!row) throw new AdminError('COMPANY_NOT_FOUND',404);
  return row;
};
export async function listCases(db:D1Database,status:string,limit=50) {
  if (!Number.isSafeInteger(limit)||limit<1||limit>100) throw new AdminError('INVALID_LIMIT',400);
  const rows=await db.prepare(`SELECT o.company_id AS companyId,c.display_name AS companyName,o.origin,o.status,o.started_at AS startedAt,o.suspended_at AS suspendedAt,o.reactivation_due_at AS reactivationDueAt,
    o.reactivation_requested_at AS reactivationRequestedAt,o.reactivation_form_due_at AS reactivationFormDueAt,o.admin_review_at AS adminReviewAt,
    o.final_notice_requested_at AS finalNoticeRequestedAt,o.final_notice_sent_at AS finalNoticeSentAt,o.final_notice_channel AS finalNoticeChannel,o.final_notice_due_at AS finalNoticeDueAt,
    o.final_notice_response_at AS finalNoticeResponseAt,o.final_notice_response AS finalNoticeResponse,o.resolution_due_at AS resolutionDueAt,o.resolved_at AS resolvedAt,o.resolution
    FROM onboarding_cases o JOIN companies c ON c.id=o.company_id WHERE o.status=? ORDER BY COALESCE(o.resolution_due_at,o.final_notice_due_at,o.admin_review_at,o.started_at) LIMIT ?`).bind(status,limit).all();
  return {cases:rows.results};
}
/** Decision 22. The 7 days run from delivery, as with the reactivation notice; a notice by other means needs evidence. */
export async function issueFinalNotice(db:D1Database,adminId:string,companyId:string,input:{reasonCode:unknown;evidence:unknown},now=new Date(),baseUrl='') {
  requireEvidence(input.reasonCode,input.evidence);
  const at=now.toISOString();
  const moved=await db.batch([
    db.prepare(`UPDATE onboarding_cases SET final_notice_requested_at=?,final_notice_requested_by=? WHERE company_id=? AND status='admin_review' AND final_notice_requested_at IS NULL`).bind(at,adminId,companyId),
    adminEvent(db,adminId,'final_notice_issued','company',companyId,input.reasonCode as string,(input.evidence as string).trim(),{},now),
  ]);
  if (moved[0]?.meta?.changes!==1) throw new AdminError('INVALID_ACTION');
  await notifyOwners(db,companyId,'onboarding_final_notice',l=>finalNoticeEmail(l,baseUrl),`final_notice:${companyId}:${at}`,now);
  return {companyId,finalNoticeRequestedAt:at,status:'queued'};
}
export async function recordFinalNoticeByOtherMeans(db:D1Database,adminId:string,companyId:string,input:{channel:unknown;recipient:unknown;reasonCode:unknown;evidence:unknown},now=new Date()) {
  requireEvidence(input.reasonCode,input.evidence);
  if (typeof input.channel!=='string'||!input.channel.trim()||input.channel.length>60||typeof input.recipient!=='string'||!input.recipient.trim()||input.recipient.length>200) throw new AdminError('INVALID_REQUEST',400);
  const ref=(input.evidence as string).trim();
  const moved=await db.batch([
    startFinalNoticeClock(db,companyId,input.recipient.trim(),input.channel.trim(),ref,now),
    adminEvent(db,adminId,'final_notice_recorded','company',companyId,input.reasonCode as string,ref,{channel:input.channel},now),
  ]);
  if (moved[0]?.meta?.changes!==1) throw new AdminError('INVALID_ACTION');
  return (await listCaseDates(db,companyId));
}
const listCaseDates=async(db:D1Database,companyId:string)=>db.prepare(`SELECT company_id AS companyId,final_notice_sent_at AS finalNoticeSentAt,final_notice_due_at AS finalNoticeDueAt FROM onboarding_cases WHERE company_id=?`).bind(companyId).first<Record<string,unknown>>().then(r=>r??{});
/** The holder answers the final notice. A late answer is still recorded: silence is what the rule addresses. */
export async function respondFinalNotice(db:D1Database,companyId:string,message:string,now=new Date()) {
  const at=now.toISOString();
  const moved=await db.batch([
    db.prepare(`UPDATE onboarding_cases SET final_notice_response_at=?,final_notice_response=? WHERE company_id=? AND status='admin_review' AND final_notice_sent_at IS NOT NULL AND final_notice_response_at IS NULL AND resolved_at IS NULL`).bind(at,message,companyId),
    openIncident(db,'final_notice_answered','warning',{companyId,dedupeKey:`final_notice_answered:${companyId}:${at}`},{},now),
  ]);
  if (moved[0]?.meta?.changes!==1) {
    await db.prepare(`DELETE FROM incidents WHERE dedupe_key=?`).bind(`final_notice_answered:${companyId}:${at}`).run();
    throw new AdminError('INVALID_ACTION');
  }
  return {companyId,finalNoticeResponseAt:at};
}
/**
 * Decisions 22, 23, 34: silence alone never cancels. Cancelling needs the final notice to have run out or been answered,
 * except after a lapsed reactivation, which the owner sent directly to individual review.
 * Only a full refund is offered for paid cases: Decision 10 leaves partial refunds undefined. The position returns
 * only once the refund is confirmed (Decision 18).
 */
export async function resolveCase(db:D1Database,env:StripeEnv,adminId:string,companyId:string,input:{decision:unknown;reasonCode:unknown;evidence:unknown},now=new Date()) {
  requireEvidence(input.reasonCode,input.evidence);
  const row=await getCase(db,companyId);
  if (row.status!=='admin_review'||row.resolved_at) throw new AdminError('INVALID_ACTION');
  const at=now.toISOString(),ref=(input.evidence as string).trim();
  const mark=(resolution:'continue'|'cancel')=>db.batch([
    db.prepare(`UPDATE onboarding_cases SET resolved_at=?,resolved_by=?,resolution=?,resolution_evidence=? WHERE company_id=?`).bind(at,adminId,resolution,ref,companyId),
    adminEvent(db,adminId,'case_resolved','company',companyId,input.reasonCode as string,ref,{resolution},now),
    db.prepare(`UPDATE incidents SET status='resolved',resolved_at=?,resolved_by=?,resolution_code=? WHERE company_id=? AND status='open' AND kind IN('onboarding_admin_review','onboarding_final_notice_expired','onboarding_resolution_overdue','onboarding_reactivation_lapsed','final_notice_answered')`).bind(at,adminId,input.reasonCode as string,companyId),
  ]);
  const baseUrl=(env as {PUBLIC_BASE_URL?:string}).PUBLIC_BASE_URL||'';
  if (input.decision==='continue') {
    // Reuses the approved reactivation path: 15 calendar days from the notice, no automatic extension.
    await decideReactivation(db,adminId,companyId,'approved',input.reasonCode,ref,now,baseUrl);
    await mark('continue');
    return {companyId,resolution:'continue',status:'reactivation_approved'};
  }
  if (input.decision!=='cancel') throw new AdminError('INVALID_ACTION',400);
  const noticeRan=!!row.final_notice_response_at||(!!row.final_notice_due_at&&row.final_notice_due_at<=at);
  if (!noticeRan&&!row.reactivation_notified_at) throw new AdminError('FINAL_NOTICE_REQUIRED');
  const published=await db.prepare(`SELECT 1 AS ok FROM slots WHERE company_id=? AND first_published_at IS NOT NULL`).bind(companyId).first();
  if (published) throw new AdminError('POSITION_ALREADY_CONSUMED');
  let refund:Record<string,unknown>|null=null;
  if (row.origin==='founder') {
    await revokeFounderAward(db,adminId,companyId,input.reasonCode,ref,now);
  } else {
    const attempt=await db.prepare(`SELECT id FROM purchase_attempts WHERE company_id=? AND status='paid'`).bind(companyId).first<{id:string}>();
    if (!attempt) throw new AdminError('INVALID_ACTION');
    await mark('cancel');
    try {refund=await requestRefund(db,env,attempt.id,input.reasonCode as string,now);}
    catch (e) {
      // The decision stands and the refund stays pending with its deadline; the provider is retried by staff.
      if (!(e instanceof IdentityError)) throw e;
      refund={attemptId:attempt.id,status:'refund_pending',providerRefundId:null,providerError:e.code};
    }
    await notifyOwners(db,companyId,'case_resolution',l=>caseResolutionEmail(l,'cancel_refund',baseUrl),`case_resolution:${companyId}:${at}`,now);
    return {companyId,resolution:'cancel',refund};
  }
  await mark('cancel');
  await notifyOwners(db,companyId,'case_resolution',l=>caseResolutionEmail(l,'cancel_founder',baseUrl),`case_resolution:${companyId}:${at}`,now);
  return {companyId,resolution:'cancel',refund};
}
