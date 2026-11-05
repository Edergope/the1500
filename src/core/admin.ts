import { IdentityError, revokeAllSessions } from './identity';
import { FOUNDER_PLACES, getSalesState, onboardingStart, releaseAssignmentStatements } from './inventory';
import { notifyOwners, openIncident, ownerContacts, startReactivationClock } from './ops';
import { founderAwardedEmail, founderInvitationEmail, premiumDecisionEmail, reactivationEmail, serviceRequestDecisionEmail } from '../lib/i18n/comms';
import { paymentsGate, type StripeEnv } from './stripe';
import { mailStatus, type MailEnv } from './mail';
import { withdrawalPlan } from './profiles';

export class AdminError extends IdentityError {
  constructor(code: string, httpStatus = 409) { super(code, httpStatus); }
}
const founderInviteMs = 7 * 24 * 60 * 60 * 1000;
interface FounderInviteRow {id:string;company_id:string;status:string;expires_at:string;}

/** No public route can elevate an account. Admins are bootstrapped from verified user IDs. */
export async function requirePlatformAdmin(db:D1Database,userId:string):Promise<void> {
  const found=await db.prepare(`SELECT 1 AS ok FROM platform_admins a JOIN users u ON u.id=a.user_id
    WHERE a.user_id=? AND a.revoked_at IS NULL AND u.status='active'`)
    .bind(userId).first<{ok:number}>();
  if (!found) throw new AdminError('ADMIN_ONLY',403);
}
export function adminEvent(db:D1Database,adminId:string,action:string,subjectType:string,subjectId:string,reasonCode:string|null,evidence:string|null,details:Record<string,unknown>,now:Date) {
  return db.prepare(`INSERT INTO admin_events(id,admin_id,action,subject_type,subject_id,reason_code,evidence_reference,details_json,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(),adminId,action,subjectType,subjectId,reasonCode,evidence,JSON.stringify(details),now.toISOString());
}
export function requireEvidence(reasonCode:unknown,evidenceReference:unknown):asserts reasonCode is string {
  if (typeof reasonCode!=='string'||!/^[a-zA-Z0-9_-]{3,64}$/.test(reasonCode)||typeof evidenceReference!=='string'||!evidenceReference.trim()||evidenceReference.length>400)
    throw new AdminError('REVIEW_EVIDENCE_REQUIRED',400);
}
const clampLimit=(limit:number,max=100)=>{if (!Number.isSafeInteger(limit)||limit<1||limit>max) throw new AdminError('INVALID_LIMIT',400);return limit;};

export async function getAdminOverview(db:D1Database,now=new Date()) {
  const [slots,founders,reviews,invites,incidents,payments,requests]=await Promise.all([
    db.prepare(`SELECT phase,status,COUNT(*) AS count FROM slots GROUP BY phase,status`).all(),
    db.prepare(`SELECT COUNT(*) AS count FROM founder_awards WHERE status='active'`).first<{count:number}>(),
    db.prepare(`SELECT COUNT(*) AS count FROM companies WHERE identity_state='pending_review'`).first<{count:number}>(),
    db.prepare(`SELECT COUNT(*) AS count FROM founder_invitations WHERE status='pending' AND expires_at>?`)
      .bind(now.toISOString()).first<{count:number}>(),
    db.prepare(`SELECT COUNT(*) AS count FROM incidents WHERE status='open'`).first<{count:number}>(),
    db.prepare(`SELECT status,COUNT(*) AS count FROM purchase_attempts GROUP BY status`).all(),
    db.prepare(`SELECT kind,COUNT(*) AS count FROM service_requests WHERE status='requested' GROUP BY kind`).all(),
  ]);
  return {capacity:1500,byPhaseAndStatus:slots.results,foundersAssigned:founders?.count??0,foundersRemaining:FOUNDER_PLACES-(founders?.count??0),
    companiesPendingReview:reviews?.count??0,pendingFounderInvitations:invites?.count??0,openIncidents:incidents?.count??0,
    paymentsByStatus:payments.results,openRequests:requests.results};
}
export async function reviewCompany(db:D1Database,companyId:string,adminId:string,
  decision:'approved'|'rejected',reasonCode:string,evidenceReference:string,now=new Date()) {
  await requirePlatformAdmin(db,adminId);
  requireEvidence(reasonCode,evidenceReference);
  const at=now.toISOString();
  const state=decision==='approved'?'admin_verified':'rejected';
  let results:D1Result[];
  try {
    results=await db.batch([
      db.prepare(`UPDATE companies SET identity_state=? WHERE id=? AND identity_state='pending_review'`)
        .bind(state,companyId),
      db.prepare(`INSERT INTO admin_review_events(id,company_id,admin_id,decision,reason_code,evidence_reference,decided_at)
        SELECT ?,?,?,?,?,?,? WHERE changes()=1 AND EXISTS(SELECT 1 FROM companies WHERE id=? AND identity_state=?)`)
        .bind(crypto.randomUUID(),companyId,adminId,decision,reasonCode,evidenceReference.trim(),at,companyId,state),
      adminEvent(db,adminId,'company_review','company',companyId,reasonCode,evidenceReference.trim(),{decision},now),
    ]);
  } catch {throw new AdminError('REVIEW_CONFLICT');}
  if (results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)
    throw new AdminError('REVIEW_CONFLICT');
  return {companyId,identityState:state,decidedAt:at};
}
/** Manual review queue, always authenticated at the route and never publicly accessible. */
export async function getCompanyReviewQueue(db:D1Database,limit=30) {
  if (!Number.isSafeInteger(limit)||limit<1||limit>50) throw new AdminError('INVALID_LIMIT',400);
  const rows=await db.prepare(`SELECT c.id,c.display_name AS displayName,c.country,c.website,
    c.industry,c.identity_state AS identityState,c.created_at AS createdAt,
    (SELECT d.id FROM companies d WHERE d.website=c.website AND d.id<>c.id AND d.identity_state IN('self_declared','admin_verified') LIMIT 1) AS duplicateOfVerifiedCompany
    FROM companies c WHERE c.identity_state='pending_review'
    ORDER BY c.created_at ASC,c.id ASC LIMIT ?`).bind(limit).all();
  return {companies:rows.results};
}
export async function listCompanies(db:D1Database,filters:{q?:string;status?:string;limit:number;offset:number}) {
  clampLimit(filters.limit);
  const like=filters.q?`%${filters.q.toLowerCase().replace(/[\\%_]/g,'\\$&')}%`:null;
  const rows=await db.prepare(`SELECT c.id,c.display_name AS displayName,c.slug,c.country,c.website,c.industry,c.identity_state AS identityState,
    c.publication_status AS publicationStatus,c.publication_block AS publicationBlock,c.created_at AS createdAt,c.published_at AS firstPublishedAt,
    s.number AS position,s.status AS positionStatus,s.assignment_kind AS assignmentKind,o.status AS onboardingStatus
    FROM companies c LEFT JOIN slots s ON s.company_id=c.id LEFT JOIN onboarding_cases o ON o.company_id=c.id
    WHERE (? IS NULL OR LOWER(c.display_name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(c.website,'')) LIKE ? ESCAPE '\\')
      AND (? IS NULL OR c.publication_status=?)
    ORDER BY c.created_at DESC LIMIT ? OFFSET ?`).bind(like,like,like,filters.status??null,filters.status??null,filters.limit,filters.offset).all();
  return {companies:rows.results,limit:filters.limit,offset:filters.offset};
}
export async function companyAdminAction(db:D1Database,adminId:string,companyId:string,action:string,reasonCode:unknown,evidence:unknown,now=new Date()) {
  requireEvidence(reasonCode,evidence);
  const at=now.toISOString();const ref=(evidence as string).trim();
  const exists=await db.prepare(`SELECT 1 AS ok FROM companies WHERE id=?`).bind(companyId).first();
  if (!exists) throw new AdminError('COMPANY_NOT_FOUND',404);
  const statement=
    action==='block_publication'?db.prepare(`UPDATE companies SET publication_block='admin_hold' WHERE id=?`).bind(companyId):
    action==='clear_block'?db.prepare(`UPDATE companies SET publication_block=NULL WHERE id=?`).bind(companyId):
    // Decision 06: outside the window, only legally required rectification reopens a profile.
    action==='grant_rectification'?db.prepare(`UPDATE companies SET correction_override_until=? WHERE id=?`).bind(new Date(now.getTime()+7*86_400_000).toISOString(),companyId):
    null;
  if (!statement) throw new AdminError('INVALID_ACTION',400);
  await db.batch([statement,adminEvent(db,adminId,action,'company',companyId,reasonCode,ref,{},now)]);
  return {companyId,action,appliedAt:at};
}
export async function setUserBlocked(db:D1Database,adminId:string,userId:string,blocked:boolean,reasonCode:unknown,evidence:unknown,now=new Date()) {
  requireEvidence(reasonCode,evidence);
  const result=await db.prepare(`UPDATE users SET status=? WHERE id=?`).bind(blocked?'blocked':'active',userId).run();
  if (result.meta.changes!==1) throw new AdminError('USER_NOT_FOUND',404);
  const revoked=blocked?await revokeAllSessions(db,userId,now):0;
  await adminEvent(db,adminId,blocked?'user_blocked':'user_unblocked','user',userId,reasonCode,(evidence as string).trim(),{revoked},now).run();
  return {userId,status:blocked?'blocked':'active',sessionsRevoked:revoked};
}
export async function getInventoryDetail(db:D1Database,limit:number,offset:number) {
  clampLimit(limit,200);
  const [phases,rows,holds]=await Promise.all([
    db.prepare(`SELECT phase,price_usd_cents AS priceUsdCents,status,assignment_kind AS assignmentKind,COUNT(*) AS count FROM slots GROUP BY phase,status,assignment_kind ORDER BY phase`).all(),
    db.prepare(`SELECT s.number AS position,s.phase,s.status,s.assignment_kind AS assignmentKind,s.assigned_at AS assignedAt,s.first_published_at AS firstPublishedAt,c.id AS companyId,c.display_name AS companyName
      FROM slots s LEFT JOIN companies c ON c.id=s.company_id WHERE s.status IN('assigned','retired') ORDER BY s.number LIMIT ? OFFSET ?`).bind(limit,offset).all(),
    db.prepare(`SELECT h.id AS holdId,h.company_id AS companyId,h.expires_at AS expiresAt,s.phase FROM slot_holds h JOIN slots s ON s.number=h.slot_number WHERE h.status='active' ORDER BY h.expires_at`).all(),
  ]);
  return {phases:phases.results,assignments:rows.results,activeHolds:holds.results,limit,offset};
}
export async function listProfilesForReview(db:D1Database,limit=50) {
  clampLimit(limit);
  const rows=await db.prepare(`SELECT v.company_id AS companyId,c.display_name AS companyName,v.version,v.review_status AS reviewStatus,v.created_at AS createdAt,v.generator_json AS generator,v.canonical_json AS canonical
    FROM profile_versions v JOIN companies c ON c.id=v.company_id WHERE v.review_status='pending' ORDER BY v.created_at LIMIT ?`).bind(limit)
    .all<{companyId:string;companyName:string;version:number;reviewStatus:string;createdAt:string;generator:string|null;canonical:string}>();
  return {profiles:rows.results.map(r=>{const c=JSON.parse(r.canonical);return {...r,canonical:c,unsupportedClaims:c.unsupportedClaims,generator:r.generator?JSON.parse(r.generator):null};})};
}
export async function reviewProfile(db:D1Database,adminId:string,companyId:string,version:number,decision:'cleared'|'rejected',reasonCode:unknown,evidence:unknown,now=new Date()) {
  requireEvidence(reasonCode,evidence);
  const result=await db.batch([
    db.prepare(`UPDATE profile_versions SET review_status=? WHERE company_id=? AND version=? AND review_status='pending'`).bind(decision,companyId,version),
    adminEvent(db,adminId,'profile_review','profile',`${companyId}:${version}`,reasonCode,(evidence as string).trim(),{decision},now),
  ]);
  if (result[0]?.meta?.changes!==1) throw new AdminError('REVIEW_CONFLICT');
  return {companyId,version,reviewStatus:decision};
}
export type LegalBasis='data_protection'|'illicit_content';
export function parseLegalBasis(value:unknown):LegalBasis|null {
  if (value===undefined||value===null) return null;
  if (value!=='data_protection'&&value!=='illicit_content') throw new AdminError('INVALID_REQUEST',400);
  return value;
}
async function insertServiceRequest(db:D1Database,input:{companyId:string;userId:string;kind:'withdrawal'|'cancellation';reason:string;legalBasis:LegalBasis|null;origin:'owner'|'recorded_by_admin';channelNote?:string|null},now:Date,extra:D1PreparedStatement[]=[]) {
  const started=await db.prepare(`SELECT MIN(processing_started_at) AS at FROM company_declarations WHERE company_id=?`).bind(input.companyId).first<{at:string|null}>();
  const id=crypto.randomUUID();
  try {
    await db.batch([
      db.prepare(`INSERT INTO service_requests(id,company_id,kind,requested_by,reason,structuring_started_at,requested_at,legal_basis,origin,channel_note) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .bind(id,input.companyId,input.kind,input.userId,input.reason,started?.at??null,now.toISOString(),input.legalBasis,input.origin,input.channelNote??null),
      openIncident(db,input.legalBasis?'legal_request_received':`${input.kind}_requested`,input.legalBasis?'critical':'warning',{companyId:input.companyId,dedupeKey:`service:${id}`},{requestId:id,legalBasis:input.legalBasis},now),
      ...extra,
    ]);
  } catch {throw new AdminError('REQUEST_ALREADY_OPEN');}
  // Decision 10: whether structuring had begun decides what refund applies, so it is stored with the request.
  return {requestId:id,kind:input.kind,status:'requested',legalBasis:input.legalBasis,requestedAt:now.toISOString(),structuringStartedAt:started?.at??null};
}
export function requestService(db:D1Database,companyId:string,userId:string,kind:'withdrawal'|'cancellation',reason:string,now=new Date(),legalBasis:LegalBasis|null=null) {
  return insertServiceRequest(db,{companyId,userId,kind,reason,legalBasis,origin:'owner'},now);
}
/** A legal request may reach administration from outside the account, for example from the affected person. */
export async function recordLegalRequest(db:D1Database,adminId:string,companyId:string,legalBasis:LegalBasis,reason:string,channelNote:string,now=new Date()) {
  const exists=await db.prepare(`SELECT 1 AS ok FROM companies WHERE id=?`).bind(companyId).first();
  if (!exists) throw new AdminError('COMPANY_NOT_FOUND',404);
  return insertServiceRequest(db,{companyId,userId:adminId,kind:'withdrawal',reason,legalBasis,origin:'recorded_by_admin',channelNote},now,
    [adminEvent(db,adminId,'legal_request_recorded','company',companyId,legalBasis,channelNote,{},now)]);
}
/** The applicable term depends on the case and the jurisdiction, so administration sets it: no number of days is assumed here. */
export async function setLegalDeadline(db:D1Database,adminId:string,requestId:string,legalDueAt:unknown,reasonCode:unknown,evidence:unknown,now=new Date()) {
  requireEvidence(reasonCode,evidence);
  if (typeof legalDueAt!=='string'||Number.isNaN(Date.parse(legalDueAt))) throw new AdminError('INVALID_REQUEST',400);
  const due=new Date(legalDueAt).toISOString();
  const result=await db.batch([
    db.prepare(`UPDATE service_requests SET legal_due_at=? WHERE id=? AND status='requested' AND legal_basis IS NOT NULL`).bind(due,requestId),
    adminEvent(db,adminId,'legal_deadline_set','service_request',requestId,reasonCode,(evidence as string).trim(),{legalDueAt:due},now),
  ]);
  if (result[0]?.meta?.changes!==1) throw new AdminError('REQUEST_NOT_FOUND',404);
  return {requestId,legalDueAt:due};
}
export async function listServiceRequests(db:D1Database,status='requested',limit=50) {
  clampLimit(limit);
  const rows=await db.prepare(`SELECT r.id,r.company_id AS companyId,c.display_name AS companyName,r.kind,r.status,r.reason,r.legal_basis AS legalBasis,r.legal_due_at AS legalDueAt,r.origin,r.channel_note AS channelNote,
    r.structuring_started_at AS structuringStartedAt,r.requested_at AS requestedAt,r.resolved_at AS resolvedAt,r.resolution_code AS resolutionCode,r.resolution_evidence AS resolutionEvidence
    FROM service_requests r JOIN companies c ON c.id=r.company_id WHERE r.status=? ORDER BY r.legal_basis IS NULL,r.legal_due_at IS NULL,r.legal_due_at,r.requested_at LIMIT ?`).bind(status,limit).all();
  return {requests:rows.results};
}
async function notifyRequestDecision(db:D1Database,companyId:string,requestId:string,kind:'withdrawal'|'cancellation',decision:'completed'|'rejected',now:Date) {
  const company=await db.prepare(`SELECT display_name FROM companies WHERE id=?`).bind(companyId).first<{display_name:string}>();
  await notifyOwners(db,companyId,'service_request_decision',l=>serviceRequestDecisionEmail(l,company?.display_name??'',kind,decision),`service_decision:${requestId}`,now);
}
/** Owner decision 2026-11-04: the holder asks, administration executes, and request and decision stay on record. */
export async function executeWithdrawal(db:D1Database,adminId:string,companyId:string,requestId:string,reasonCode:unknown,evidence:unknown,now=new Date()) {
  requireEvidence(reasonCode,evidence);
  const request=await db.prepare(`SELECT id FROM service_requests WHERE id=? AND company_id=? AND kind='withdrawal' AND status='requested'`).bind(requestId,companyId).first();
  if (!request) throw new AdminError('REQUEST_NOT_FOUND',404);
  const plan=await withdrawalPlan(db,companyId,requestId,now);
  const ref=(evidence as string).trim();
  await db.batch([
    ...plan.statements,
    // Withdrawal is one fact: every request open for it is answered by this decision.
    db.prepare(`UPDATE service_requests SET status='completed',resolved_at=?,resolved_by=?,resolution_code=?,resolution_evidence=? WHERE company_id=? AND kind='withdrawal' AND status='requested'`)
      .bind(now.toISOString(),adminId,reasonCode,ref,companyId),
    adminEvent(db,adminId,'withdrawal','company',companyId,reasonCode,ref,{requestId},now),
  ]);
  await notifyRequestDecision(db,companyId,requestId,'withdrawal','completed',now);
  return plan.result;
}
export async function resolveServiceRequest(db:D1Database,adminId:string,requestId:string,decision:unknown,reasonCode:unknown,evidence:unknown,now=new Date()) {
  requireEvidence(reasonCode,evidence);
  const request=await db.prepare(`SELECT company_id,kind FROM service_requests WHERE id=? AND status='requested'`).bind(requestId).first<{company_id:string;kind:'withdrawal'|'cancellation'}>();
  if (!request) throw new AdminError('REQUEST_NOT_FOUND',404);
  // A withdrawal is only ever completed by executing it.
  if (decision!=='rejected'&&!(decision==='completed'&&request.kind==='cancellation')) throw new AdminError('INVALID_ACTION',400);
  const ref=(evidence as string).trim();
  await db.batch([
    db.prepare(`UPDATE service_requests SET status=?,resolved_at=?,resolved_by=?,resolution_code=?,resolution_evidence=? WHERE id=? AND status='requested'`)
      .bind(decision,now.toISOString(),adminId,reasonCode,ref,requestId),
    adminEvent(db,adminId,'service_request_resolved','service_request',requestId,reasonCode,ref,{decision},now),
  ]);
  await notifyRequestDecision(db,request.company_id,requestId,request.kind,decision,now);
  return {requestId,status:decision};
}
/** Decision 21: the owner may ask until day 45. Asking does not reopen the form; administration decides. */
export async function requestReactivation(db:D1Database,companyId:string,now=new Date()) {
  const at=now.toISOString();
  const result=await db.batch([
    db.prepare(`UPDATE onboarding_cases SET status='reactivation_requested',reactivation_requested_at=? WHERE company_id=? AND status='suspended' AND reactivation_due_at>?`).bind(at,companyId,at),
    openIncident(db,'reactivation_requested','warning',{companyId,dedupeKey:`reactivation_requested:${companyId}:${at}`},{},now),
  ]);
  if (result[0]?.meta?.changes!==1) {
    await db.prepare(`UPDATE incidents SET status='resolved',resolved_at=?,resolution_code='not_applicable' WHERE dedupe_key=?`).bind(at,`reactivation_requested:${companyId}:${at}`).run();
    throw new AdminError('INVALID_ACTION');
  }
  return {companyId,status:'reactivation_requested',reactivationRequestedAt:at};
}
/**
 * Owner decision 2026-11-04. Approval queues the notice; the 15 days start when it is actually delivered (ops.flushNotifications)
 * or when administration records having notified by another means. An approval from individual review is a fresh human decision.
 */
export async function decideReactivation(db:D1Database,adminId:string,companyId:string,decision:unknown,reasonCode:unknown,evidence:unknown,now=new Date(),baseUrl='') {
  requireEvidence(reasonCode,evidence);
  const at=now.toISOString(),ref=(evidence as string).trim();
  const event=adminEvent(db,adminId,'reactivation_decision','company',companyId,reasonCode,ref,{decision},now);
  let moved:D1PreparedStatement;
  if (decision==='approved') moved=db.prepare(`UPDATE onboarding_cases SET status='reactivation_approved',reactivation_approved_at=?,reactivation_approved_by=?,reactivation_notified_at=NULL,reactivation_form_due_at=NULL WHERE company_id=? AND status IN('reactivation_requested','admin_review')`).bind(at,adminId,companyId);
  else if (decision==='rejected') moved=db.prepare(`UPDATE onboarding_cases SET status='admin_review',admin_review_at=? WHERE company_id=? AND status='reactivation_requested'`).bind(at,companyId);
  else if (decision==='notified_by_other_means') moved=startReactivationClock(db,companyId,now);
  else throw new AdminError('INVALID_ACTION',400);
  const result=await db.batch([moved,event]);
  if (result[0]?.meta?.changes!==1) throw new AdminError('INVALID_ACTION');
  if (decision==='approved') await notifyOwners(db,companyId,'reactivation_approved',l=>reactivationEmail(l,'approved',baseUrl),`reactivation_approved:${companyId}:${at}`,now);
  if (decision==='rejected') await notifyOwners(db,companyId,'reactivation_rejected',l=>reactivationEmail(l,'rejected',baseUrl),`reactivation_rejected:${companyId}:${at}`,now);
  return db.prepare(`SELECT company_id AS companyId,status,reactivation_approved_at AS reactivationApprovedAt,reactivation_notified_at AS reactivationNotifiedAt,reactivation_form_due_at AS reactivationFormDueAt FROM onboarding_cases WHERE company_id=?`).bind(companyId).first<Record<string,unknown>>().then(r=>r??{});
}
/** Reports presence and mode only. No secret value ever leaves this function. */
export function integrationStatus(env:StripeEnv&MailEnv&{AI_API_KEY?:string;AI_PROVIDER?:string;AI_MODEL?:string;SNAPSHOTS?:unknown}) {
  const gate=paymentsGate(env);
  return {
    mail:mailStatus(env),
    stripe:{enabled:env.PAYMENTS_ENABLED==='true',keyPresent:!!env.STRIPE_SECRET_KEY,keyIsTestMode:env.STRIPE_SECRET_KEY?/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY):null,webhookSecretPresent:!!env.STRIPE_WEBHOOK_SECRET,gate:gate.ok?'open_test_mode':gate.code},
    ai:{configured:!!env.AI_API_KEY,provider:env.AI_PROVIDER??null,model:env.AI_MODEL??null},
    publicBaseUrl:env.PUBLIC_BASE_URL??null,snapshotsBound:!!env.SNAPSHOTS,
  };
}
export async function listIncidents(db:D1Database,status:string,limit=50) {
  clampLimit(limit);
  const rows=await db.prepare(`SELECT id,kind,severity,company_id AS companyId,attempt_id AS attemptId,details_json AS details,status,created_at AS createdAt,resolved_at AS resolvedAt,resolution_code AS resolutionCode
    FROM incidents WHERE status=? ORDER BY created_at DESC LIMIT ?`).bind(status,limit).all<{details:string}>();
  return {incidents:rows.results.map(r=>({...r,details:JSON.parse(r.details)}))};
}
export async function resolveIncident(db:D1Database,adminId:string,id:string,reasonCode:unknown,evidence:unknown,now=new Date()) {
  requireEvidence(reasonCode,evidence);
  const result=await db.batch([
    db.prepare(`UPDATE incidents SET status='resolved',resolved_at=?,resolved_by=?,resolution_code=? WHERE id=? AND status='open'`).bind(now.toISOString(),adminId,reasonCode,id),
    adminEvent(db,adminId,'incident_resolved','incident',id,reasonCode,(evidence as string).trim(),{},now),
  ]);
  if (result[0]?.meta?.changes!==1) throw new AdminError('REQUEST_NOT_FOUND',404);
  return {id,status:'resolved'};
}
export async function listPayments(db:D1Database,status:string|null,limit=50) {
  clampLimit(limit);
  const rows=await db.prepare(`SELECT a.id,a.company_id AS companyId,c.display_name AS companyName,a.phase,a.assigned_slot_number AS position,a.provider,a.provider_session_id AS providerSessionId,a.provider_payment_intent AS providerPaymentIntent,
    a.amount_usd_cents AS amountUsdCents,a.total_minor AS totalMinor,a.charged_currency AS currency,a.status,a.hold_expires_at AS holdExpiresAt,a.checkout_expires_at AS checkoutExpiresAt,a.paid_at AS paidAt,a.payer_email AS payerEmail,a.payer_review AS payerReview,a.refund_reason AS refundReason,a.refund_requested_at AS refundRequestedAt,a.refund_order_due_at AS refundOrderDueAt,a.refund_method AS refundMethod,a.refund_operation_ref AS refundOperationRef,a.refund_confirmed_at AS refundConfirmedAt,a.regularization_due_at AS regularizationDueAt,a.chargeback_resolution AS chargebackResolution,a.created_at AS createdAt
    FROM purchase_attempts a JOIN companies c ON c.id=a.company_id WHERE (? IS NULL OR a.status=?) ORDER BY a.created_at DESC LIMIT ?`).bind(status,status,limit).all();
  return {payments:rows.results};
}
/** Company must already exist and have an active owner; invitation is visible in owner's account. */
export async function inviteFounder(db:D1Database,adminId:string,companyId:string,now=new Date(),baseUrl='') {
  await requirePlatformAdmin(db,adminId);
  const company=await db.prepare(`SELECT c.identity_state,c.publication_status,c.display_name,
    (SELECT COUNT(*) FROM memberships m WHERE m.company_id=c.id AND m.role='owner') AS owners,
    (SELECT COUNT(*) FROM slots s WHERE s.company_id=c.id AND s.status IN('assigned','retired')) AS assigned
    FROM companies c WHERE c.id=?`).bind(companyId)
    .first<{identity_state:string;publication_status:string;display_name:string;owners:number;assigned:number}>();
  if (!company||!['self_declared','admin_verified'].includes(company.identity_state)||company.owners<1)
    throw new AdminError('FOUNDER_COMPANY_NOT_ELIGIBLE',403);
  if (company.assigned) throw new AdminError('COMPANY_ALREADY_ASSIGNED');
  await assertFounderCapacity(db);
  const open=await db.prepare(`SELECT 1 AS ok FROM founder_invitations WHERE company_id=? AND status='accepted'`).bind(companyId).first();
  if (open) throw new AdminError('FOUNDER_INVITATION_EXISTS');
  const nowIso=now.toISOString();
  // Expired invitations are closed before applying the pending uniqueness constraint.
  await db.prepare(`UPDATE founder_invitations SET status='expired'
    WHERE status='pending' AND expires_at<=?`).bind(nowIso).run();
  const id=crypto.randomUUID();const expiration=new Date(now.getTime()+founderInviteMs).toISOString();
  try {
    await db.batch([
      db.prepare(`INSERT INTO founder_invitations(id,company_id,invited_by,created_at,expires_at)
        VALUES(?,?,?,?,?)`).bind(id,companyId,adminId,nowIso,expiration),
      adminEvent(db,adminId,'founder_invited','company',companyId,null,null,{invitationId:id},now),
    ]);
  } catch {throw new AdminError('FOUNDER_INVITATION_EXISTS');}
  await notifyOwners(db,companyId,'founder_invitation',l=>founderInvitationEmail(l,company.display_name,expiration,baseUrl),`founder_invite:${id}`,now);
  const owners=await ownerContacts(db,companyId);
  return {invitationId:id,companyId,status:'pending',expiresAt:expiration,
    delivery:'owner_portal_and_email_queue',emailQueuedFor:owners.length};
}
async function assertFounderCapacity(db:D1Database) {
  const state=await db.prepare(`SELECT (SELECT COUNT(*) FROM founder_awards WHERE status='active') AS awarded,
    (SELECT COUNT(*) FROM slots WHERE number BETWEEN 1 AND 100 AND status='available') AS free`).first<{awarded:number;free:number}>();
  if (!state||state.awarded>=FOUNDER_PLACES||state.free<1) throw new AdminError('FOUNDER_INVENTORY_EXHAUSTED');
}
export async function listOwnerFounderInvitations(db:D1Database,userId:string,now=new Date()) {
  const rows=await db.prepare(`SELECT fi.id AS invitationId,fi.company_id AS companyId,
    c.display_name AS companyName,fi.expires_at AS expiresAt
    FROM founder_invitations fi JOIN memberships m ON m.company_id=fi.company_id
    JOIN companies c ON c.id=fi.company_id
    WHERE m.user_id=? AND m.role='owner' AND fi.status='pending' AND fi.expires_at>?
    ORDER BY fi.created_at DESC`).bind(userId,now.toISOString()).all();
  return {invitations:rows.results};
}
/** Step 2 of 3. The owner accepts the conditions, authenticated. This consumes no position (Decisions 32-33). */
export async function acceptFounderInvitation(db:D1Database,invitationId:string,userId:string,now=new Date(),termsVersion='founder-terms-pending') {
  const invite=await db.prepare(`SELECT fi.id,fi.company_id,fi.status,fi.expires_at
    FROM founder_invitations fi JOIN memberships m ON m.company_id=fi.company_id
    WHERE fi.id=? AND m.user_id=? AND m.role='owner'`).bind(invitationId,userId)
    .first<FounderInviteRow>();
  if (!invite) throw new AdminError('INVITATION_NOT_FOUND',404);
  const at=now.toISOString();
  if (invite.status!=='pending'||invite.expires_at<=at) throw new AdminError('INVITATION_EXPIRED');
  const result=await db.batch([
    db.prepare(`UPDATE founder_invitations SET status='accepted',accepted_at=?,accepted_by=? WHERE id=? AND status='pending' AND expires_at>?`)
      .bind(at,userId,invite.id,at),
    db.prepare(`INSERT INTO consent_records(id,company_id,user_id,kind,document_version,accepted_at)
      SELECT ?,?,?,'founder_terms',?,? WHERE EXISTS(SELECT 1 FROM founder_invitations WHERE id=? AND accepted_at=? AND accepted_by=?)`)
      .bind(crypto.randomUUID(),invite.company_id,userId,termsVersion,at,invite.id,at,userId),
  ]);
  if (result[0]?.meta?.changes!==1) throw new AdminError('INVITATION_EXPIRED');
  return {invitationId:invite.id,companyId:invite.company_id,status:'accepted',acceptedAt:at};
}
export async function listAcceptedFounderInvitations(db:D1Database,limit=50) {
  clampLimit(limit);
  const rows=await db.prepare(`SELECT fi.id AS invitationId,fi.company_id AS companyId,c.display_name AS companyName,fi.accepted_at AS acceptedAt
    FROM founder_invitations fi JOIN companies c ON c.id=fi.company_id
    WHERE fi.status='accepted' AND NOT EXISTS(SELECT 1 FROM founder_awards a WHERE a.company_id=fi.company_id AND a.status='active')
    ORDER BY fi.accepted_at LIMIT ?`).bind(limit).all();
  return {invitations:rows.results};
}
/** Step 3 of 3. Formal administrative award: assigns the next number in 1-100 and starts the onboarding clock. */
export async function awardFounder(db:D1Database,adminId:string,invitationId:string,reasonCode:unknown,evidence:unknown,now=new Date(),baseUrl='') {
  requireEvidence(reasonCode,evidence);
  const invite=await db.prepare(`SELECT fi.company_id,fi.status,c.display_name FROM founder_invitations fi JOIN companies c ON c.id=fi.company_id WHERE fi.id=?`)
    .bind(invitationId).first<{company_id:string;status:string;display_name:string}>();
  if (!invite) throw new AdminError('INVITATION_NOT_FOUND',404);
  if (invite.status!=='accepted') throw new AdminError('INVITATION_NOT_ACCEPTED');
  const companyId=invite.company_id;
  await assertFounderCapacity(db);
  const at=now.toISOString(),awardId=crypto.randomUUID();
  const invited=`EXISTS(SELECT 1 FROM founder_invitations fi WHERE fi.id=? AND fi.company_id=? AND fi.status='accepted')`;
  const awarded=`EXISTS(SELECT 1 FROM founder_awards WHERE id=?)`;
  try {
    const result=await db.batch([
      // Next ascending number in the founders' reserved range, 1-100.
      db.prepare(`UPDATE slots SET status='assigned',company_id=?,assignment_kind='founder',assigned_at=?
        WHERE number=(SELECT MIN(number) FROM slots WHERE number BETWEEN 1 AND 100 AND status='available')
        AND (SELECT COUNT(*) FROM founder_awards WHERE status='active')<${FOUNDER_PLACES}
        AND NOT EXISTS(SELECT 1 FROM slots s WHERE s.company_id=? AND s.status IN('assigned','retired'))
        AND ${invited}`).bind(companyId,at,companyId,invitationId,companyId),
      db.prepare(`INSERT INTO founder_awards(id,slot_number,company_id,approved_by,status,awarded_at)
        SELECT ?,number,?,?,'active',? FROM slots WHERE company_id=? AND status='assigned' AND assignment_kind='founder' AND ${invited}`)
        .bind(awardId,companyId,adminId,at,companyId,invitationId,companyId),
      db.prepare(`INSERT INTO slot_audit(event_id,slot_number,action,company_id,reference_id,occurred_at)
        SELECT ?,number,'assign_founder',company_id,?,? FROM slots WHERE company_id=? AND status='assigned' AND ${awarded}`)
        .bind(crypto.randomUUID(),awardId,at,companyId,awardId),
      onboardingStart(db,companyId,'founder',now,awarded,awardId),
      adminEvent(db,adminId,'founder_awarded','company',companyId,reasonCode,(evidence as string).trim(),{invitationId,awardId},now),
    ]);
    // The statement touches one row at most (a primary key). D1 also counts what triggers write, so this asks for any change, not exactly one.
    if (!result[0]?.meta?.changes) throw new AdminError('FOUNDER_ASSIGNMENT_CONFLICT');
  } catch(e) {if (e instanceof AdminError) throw e;throw new AdminError('FOUNDER_ASSIGNMENT_CONFLICT');}
  const slot=await db.prepare(`SELECT number FROM slots WHERE company_id=?`).bind(companyId).first<{number:number}>();
  await notifyOwners(db,companyId,'founder_awarded',l=>founderAwardedEmail(l,invite.display_name,slot!.number,baseUrl),`founder_award:${awardId}`,now);
  return {companyId,slotNumber:slot!.number,status:'assigned',assignmentKind:'founder'};
}
/** Decision 34: before first publication only. A published position is never reassigned. */
export async function revokeFounderAward(db:D1Database,adminId:string,companyId:string,reasonCode:unknown,evidence:unknown,now=new Date()) {
  requireEvidence(reasonCode,evidence);
  const award=await db.prepare(`SELECT a.id,a.slot_number,s.first_published_at FROM founder_awards a JOIN slots s ON s.number=a.slot_number WHERE a.company_id=? AND a.status='active'`)
    .bind(companyId).first<{id:string;slot_number:number;first_published_at:string|null}>();
  if (!award) throw new AdminError('INVITATION_NOT_FOUND',404);
  if (award.first_published_at) throw new AdminError('POSITION_ALREADY_CONSUMED');
  await db.batch([
    db.prepare(`UPDATE founder_awards SET status='revoked',revoked_at=? WHERE id=?`).bind(now.toISOString(),award.id),
    // Another award needs a new invitation.
    db.prepare(`UPDATE founder_invitations SET status='revoked' WHERE company_id=? AND status='accepted'`).bind(companyId),
    ...releaseAssignmentStatements(db,award.slot_number,companyId,'revoke_founder',award.id,now),
    adminEvent(db,adminId,'founder_revoked','company',companyId,reasonCode,(evidence as string).trim(),{position:award.slot_number},now),
  ]);
  return {companyId,status:'revoked',positionReleased:award.slot_number};
}
/** Decision 64: application form in the portal, once Premium is the tier available. It holds no position and there is no checkout. */
export async function submitPremiumRequest(db:D1Database,companyId:string,userId:string,input:{message:string;contactPreference:'email'|'meeting'|'no_preference'},now=new Date()) {
  const sales=await getSalesState(db);
  if (sales.mode!=='premium_admission') throw new AdminError('PREMIUM_NOT_OPEN');
  const company=await db.prepare(`SELECT identity_state,(SELECT COUNT(*) FROM slots s WHERE s.company_id=companies.id AND s.status IN('assigned','retired')) AS assigned FROM companies WHERE id=?`)
    .bind(companyId).first<{identity_state:string;assigned:number}>();
  if (!company||!['self_declared','admin_verified'].includes(company.identity_state)) throw new AdminError('COMPANY_NOT_ELIGIBLE',403);
  if (company.assigned) throw new AdminError('COMPANY_ALREADY_ASSIGNED');
  const id=crypto.randomUUID(),at=now.toISOString();
  try {
    await db.batch([
      db.prepare(`INSERT INTO premium_requests(id,company_id,channel_note,recorded_by,message,contact_preference,created_at,updated_at) VALUES(?,?,'portal_form',?,?,?,?,?)`).bind(id,companyId,userId,input.message,input.contactPreference,at,at),
      openIncident(db,'premium_request_received','info',{companyId,dedupeKey:`premium:${id}`},{requestId:id},now),
    ]);
  } catch {throw new AdminError('REQUEST_ALREADY_OPEN');}
  return {requestId:id,companyId,status:'received',contactPreference:input.contactPreference,createdAt:at};
}
export async function listPremiumRequests(db:D1Database,limit=50) {
  clampLimit(limit);
  const rows=await db.prepare(`SELECT p.id,p.company_id AS companyId,c.display_name AS companyName,c.website,c.identity_state AS identityState,u.email AS applicantEmail,p.status,p.message,p.contact_preference AS contactPreference,p.created_at AS createdAt,p.updated_at AS updatedAt
    FROM premium_requests p JOIN companies c ON c.id=p.company_id LEFT JOIN users u ON u.id=p.recorded_by ORDER BY p.created_at DESC LIMIT ?`).bind(limit).all();
  return {requests:rows.results};
}
/** Email exchanges or meetings that informed the evaluation are cited in the evidence reference. Neither is a requirement. */
export async function updatePremiumRequest(db:D1Database,adminId:string,requestId:string,status:string,reasonCode:unknown,evidence:unknown,now=new Date()) {
  requireEvidence(reasonCode,evidence);
  if (status!=='in_review'&&status!=='accepted'&&status!=='rejected') throw new AdminError('INVALID_ACTION',400);
  const result=await db.batch([
    db.prepare(`UPDATE premium_requests SET status=?,updated_at=? WHERE id=? AND status IN('received','in_review','accepted')`).bind(status,now.toISOString(),requestId),
    adminEvent(db,adminId,'premium_status','premium_request',requestId,reasonCode,(evidence as string).trim(),{status},now),
  ]);
  if (result[0]?.meta?.changes!==1) throw new AdminError('REQUEST_NOT_FOUND',404);
  const request=await db.prepare(`SELECT p.company_id,c.display_name FROM premium_requests p JOIN companies c ON c.id=p.company_id WHERE p.id=?`).bind(requestId).first<{company_id:string;display_name:string}>();
  if (request) await notifyOwners(db,request.company_id,'premium_decision',l=>premiumDecisionEmail(l,request.display_name,status),`premium_decision:${requestId}:${status}`,now);
  return {requestId,status};
}
/** Only after human acceptance and credited funds, referenced as evidence. Never automatic, never before tier 4 opens. */
export async function assignPremium(db:D1Database,adminId:string,requestId:string,reasonCode:unknown,fundsEvidence:unknown,now=new Date()) {
  requireEvidence(reasonCode,fundsEvidence);
  const request=await db.prepare(`SELECT company_id FROM premium_requests WHERE id=? AND status='accepted'`).bind(requestId).first<{company_id:string}>();
  if (!request) throw new AdminError('REQUEST_NOT_FOUND',404);
  const at=now.toISOString();
  const open=`(SELECT MIN(phase) FROM slots WHERE status IN('available','held'))=4`;
  try {
    const result=await db.batch([
      db.prepare(`UPDATE slots SET status='assigned',company_id=?,assignment_kind='premium',assigned_at=?
        WHERE number=(SELECT MIN(number) FROM slots WHERE phase=4 AND status='available') AND ${open}
        AND NOT EXISTS(SELECT 1 FROM slots s WHERE s.company_id=? AND s.status IN('assigned','retired'))`).bind(request.company_id,at,request.company_id),
      db.prepare(`INSERT INTO slot_audit(event_id,slot_number,action,company_id,reference_id,occurred_at)
        SELECT ?,number,'assign_premium',company_id,?,? FROM slots WHERE company_id=? AND assignment_kind='premium' AND status='assigned'`).bind(crypto.randomUUID(),requestId,at,request.company_id),
      db.prepare(`UPDATE premium_requests SET status='assigned',updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM slots WHERE company_id=? AND assignment_kind='premium')`).bind(at,requestId,request.company_id),
      onboardingStart(db,request.company_id,'premium',now,`EXISTS(SELECT 1 FROM slots WHERE company_id=? AND assignment_kind='premium')`,request.company_id),
      adminEvent(db,adminId,'premium_assigned','premium_request',requestId,reasonCode,(fundsEvidence as string).trim(),{},now),
    ]);
    // The statement touches one row at most (a primary key). D1 also counts what triggers write, so this asks for any change, not exactly one.
    if (!result[0]?.meta?.changes) throw new AdminError('PAYMENT_STATE_CONFLICT');
  } catch(e) {if (e instanceof AdminError) throw e;throw new AdminError('PAYMENT_STATE_CONFLICT');}
  const slot=await db.prepare(`SELECT number FROM slots WHERE company_id=?`).bind(request.company_id).first<{number:number}>();
  return {requestId,companyId:request.company_id,position:slot?.number,status:'assigned'};
}
/** Seller identity is data, not code. Approving a seller does not enable live payments: stripe.ts still refuses live keys. */
export async function updateSeller(db:D1Database,adminId:string,input:{sellerEntityId:string;legalName:string;country:string},reasonCode:unknown,evidence:unknown,now=new Date()) {
  requireEvidence(reasonCode,evidence);
  await db.batch([
    db.prepare(`UPDATE legal_seller_configuration SET seller_entity_id=?,seller_legal_name=?,seller_country=?,updated_at=? WHERE id=1`).bind(input.sellerEntityId,input.legalName,input.country,now.toISOString()),
    adminEvent(db,adminId,'seller_updated','seller','1',reasonCode,(evidence as string).trim(),input,now),
  ]);
  return {...input,status:'unapproved'};
}
