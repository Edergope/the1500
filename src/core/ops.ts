import {onboardingEmail,reactivationEmail} from '../lib/i18n/comms';
import type {Locale} from '../lib/i18n/messages';
import {sendMail,mailConfigured,type MailEnv} from './mail';
import {expireStaleHolds} from './inventory';

export function openIncident(db:D1Database,kind:string,severity:'info'|'warning'|'critical',refs:{companyId?:string|null;attemptId?:string|null;dedupeKey?:string},details:Record<string,unknown>,now=new Date()) {
  return db.prepare(`INSERT OR IGNORE INTO incidents(id,kind,severity,company_id,attempt_id,dedupe_key,details_json,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),kind,severity,refs.companyId??null,refs.attemptId??null,refs.dedupeKey??null,JSON.stringify(details),now.toISOString());
}
export function queueNotification(db:D1Database,kind:string,recipient:string,locale:Locale,message:{subject:string;text:string},dedupeKey:string,companyId:string|null,now=new Date()) {
  return db.prepare(`INSERT OR IGNORE INTO notifications(id,kind,recipient,locale,subject,body,dedupe_key,company_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),kind,recipient,locale,message.subject,message.text,dedupeKey,companyId,now.toISOString());
}
/** Owner decision 2026-11-04: 15 calendar days from the approved reactivation being notified, once, with no extension. */
export const REACTIVATION_FORM_DAYS=15;
export function startReactivationClock(db:D1Database,companyId:string,notifiedAt:Date) {
  return db.prepare(`UPDATE onboarding_cases SET status='reactivated',reactivation_notified_at=?,reactivation_form_due_at=? WHERE company_id=? AND status='reactivation_approved'`)
    .bind(notifiedAt.toISOString(),new Date(notifiedAt.getTime()+REACTIVATION_FORM_DAYS*86_400_000).toISOString(),companyId);
}
/** Decision 22: 7 calendar days to reply to the final notice, from its delivery. */
export function startFinalNoticeClock(db:D1Database,companyId:string,recipient:string,channel:string,evidence:string,sentAt:Date) {
  return db.prepare(`UPDATE onboarding_cases SET final_notice_sent_at=?,final_notice_due_at=?,final_notice_channel=?,final_notice_recipient=?,final_notice_evidence=? WHERE company_id=? AND status='admin_review' AND final_notice_requested_at IS NOT NULL AND final_notice_sent_at IS NULL`)
    .bind(sentAt.toISOString(),new Date(sentAt.getTime()+7*86_400_000).toISOString(),channel,recipient,evidence,companyId);
}
/** Monday to Friday. Public holidays are not modelled: administration must allow for them when a term is tight. */
export function addBusinessDays(from:Date,days:number) {
  const date=new Date(from.getTime());let left=days;
  while (left>0) {date.setUTCDate(date.getUTCDate()+1);if (date.getUTCDay()!==0&&date.getUTCDay()!==6) left--;}
  return date;
}
/** Sends what is queued. Nothing is marked sent unless the provider accepted it. */
export async function flushNotifications(db:D1Database,env:MailEnv,now=new Date(),limit=20):Promise<{sent:number;failed:number;skipped:boolean;blocked:boolean}> {
  if (!mailConfigured(env)) return {sent:0,failed:0,skipped:true,blocked:false};
  const pending=await db.prepare(`SELECT id,kind,company_id,recipient,subject,body,attempts FROM notifications WHERE status='pending' ORDER BY created_at LIMIT ?`)
    .bind(limit).all<{id:string;kind:string;company_id:string|null;recipient:string;subject:string;body:string;attempts:number}>();
  let sent=0,failed=0,blocked=false;
  for (const n of pending.results) {
    const outcome=await sendMail(env,{to:n.recipient,subject:n.subject,text:n.body});
    if (outcome.accepted) {
      sent++;await db.prepare(`UPDATE notifications SET status='sent',sent_at=?,attempts=attempts+1,provider=?,provider_message_id=?,failure_code=NULL WHERE id=?`).bind(now.toISOString(),outcome.provider,outcome.messageId,n.id).run();
      if (n.kind==='reactivation_approved'&&n.company_id) await startReactivationClock(db,n.company_id,now).run();
      if (n.kind==='onboarding_final_notice'&&n.company_id) await startFinalNoticeClock(db,n.company_id,n.recipient,'email',outcome.messageId??outcome.provider,now).run();
    } else if (outcome.failure==='blocked') {
      // Quota or sender problem: the whole queue waits, and no message uses up its attempts meanwhile.
      blocked=true;
      await openIncident(db,'mail_provider_blocked','critical',{dedupeKey:`mail_blocked:${outcome.code}:${now.toISOString().slice(0,10)}`},{provider:outcome.provider,code:outcome.code},now).run();
      break;
    } else {
      failed++;
      const final=outcome.failure==='rejected'||n.attempts>=4;
      await db.prepare(`UPDATE notifications SET attempts=attempts+1,status=?,provider=?,failure_code=? WHERE id=?`).bind(final?'failed':'pending',outcome.provider,outcome.code,n.id).run();
      if (final) await openIncident(db,'notification_failed','warning',{companyId:n.company_id,dedupeKey:`notification_failed:${n.id}`},{kind:n.kind,provider:outcome.provider,code:outcome.code},now).run();
    }
  }
  return {sent,failed,skipped:false,blocked};
}
export async function ownerContacts(db:D1Database,companyId:string) {
  const rows=await db.prepare(`SELECT u.email,u.locale FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=? AND m.role='owner'`)
    .bind(companyId).all<{email:string;locale:Locale}>();
  return rows.results;
}
export async function notifyOwners(db:D1Database,companyId:string,kind:string,build:(l:Locale)=>{subject:string;text:string},dedupe:string,now=new Date()) {
  const owners=await ownerContacts(db,companyId);
  if (owners.length) await db.batch(owners.map(o=>queueNotification(db,kind,o.email,o.locale,build(o.locale),`${dedupe}:${o.email}`,companyId,now)));
}
/** Decisions 19-21, 34. Time-driven moves only: suspension never cancels, charges or frees a position. */
export async function sweepOnboarding(db:D1Database,baseUrl:string,now=new Date()) {
  const at=now.toISOString();
  const moved={extended:0,suspended:0,adminReview:0,reactivationLapsed:0};
  const due=await db.prepare(`SELECT company_id,status,form_due_at,extension_due_at,reactivation_due_at FROM onboarding_cases
    WHERE status IN('active','extended','suspended') AND form_due_at<=?`).bind(at)
    .all<{company_id:string;status:string;form_due_at:string;extension_due_at:string;reactivation_due_at:string}>();
  for (const c of due.results) {
    if (c.status==='active'&&c.extension_due_at>at) {
      await db.prepare(`UPDATE onboarding_cases SET status='extended',extended_at=? WHERE company_id=? AND status='active'`).bind(at,c.company_id).run();
      await notifyOwners(db,c.company_id,'onboarding_extended',l=>onboardingEmail(l,'extended',baseUrl),`onboarding_extended:${c.company_id}`,now);
      moved.extended++;
    } else if (['active','extended'].includes(c.status)&&c.extension_due_at<=at) {
      await db.batch([
        db.prepare(`UPDATE onboarding_cases SET status='suspended',suspended_at=? WHERE company_id=? AND status IN('active','extended')`).bind(at,c.company_id),
        openIncident(db,'onboarding_suspended','info',{companyId:c.company_id,dedupeKey:`onboarding_suspended:${c.company_id}`},{},now),
      ]);
      await notifyOwners(db,c.company_id,'onboarding_suspended',l=>onboardingEmail(l,'suspended',baseUrl),`onboarding_suspended:${c.company_id}`,now);
      moved.suspended++;
    } else if (c.status==='suspended'&&c.reactivation_due_at<=at) {
      await db.batch([
        db.prepare(`UPDATE onboarding_cases SET status='admin_review',admin_review_at=? WHERE company_id=? AND status='suspended'`).bind(at,c.company_id),
        openIncident(db,'onboarding_admin_review','warning',{companyId:c.company_id,dedupeKey:`onboarding_admin_review:${c.company_id}`},{note:'Decisions 22-23: final notice and individual review are required; silence does not cancel.'},now),
      ]);
      moved.adminReview++;
    }
  }
  // Failing again after a reactivation goes to individual review: no second extension, and nothing is lost automatically.
  const lapsed=await db.prepare(`SELECT company_id FROM onboarding_cases WHERE status='reactivated' AND reactivation_form_due_at<=?`).bind(at).all<{company_id:string}>();
  for (const c of lapsed.results) {
    await db.batch([
      // A new review, so any earlier decision to continue no longer closes it.
      db.prepare(`UPDATE onboarding_cases SET status='admin_review',admin_review_at=?,resolved_at=NULL,resolved_by=NULL,resolution=NULL,resolution_due_at=NULL WHERE company_id=? AND status='reactivated'`).bind(at,c.company_id),
      openIncident(db,'onboarding_reactivation_lapsed','warning',{companyId:c.company_id,dedupeKey:`onboarding_reactivation_lapsed:${c.company_id}:${at}`},{note:'Individual review. The position and the money are not lost automatically.'},now),
    ]);
    await notifyOwners(db,c.company_id,'onboarding_reactivation_lapsed',l=>reactivationEmail(l,'lapsed',baseUrl),`onboarding_reactivation_lapsed:${c.company_id}:${at}`,now);
    moved.reactivationLapsed++;
  }
  return moved;
}
/** Deadlines that only raise visibility: every decision behind them stays human (Decisions 22-24, 28). */
export async function sweepCaseDeadlines(db:D1Database,now=new Date()) {
  const at=now.toISOString();
  const expired=await db.prepare(`SELECT company_id,final_notice_due_at FROM onboarding_cases WHERE status='admin_review' AND final_notice_due_at<=? AND final_notice_response_at IS NULL AND resolution_due_at IS NULL AND resolved_at IS NULL`).bind(at).all<{company_id:string;final_notice_due_at:string}>();
  for (const c of expired.results) {
    const due=addBusinessDays(new Date(c.final_notice_due_at),5).toISOString();
    await db.batch([
      db.prepare(`UPDATE onboarding_cases SET resolution_due_at=? WHERE company_id=? AND resolution_due_at IS NULL`).bind(due,c.company_id),
      openIncident(db,'onboarding_final_notice_expired','warning',{companyId:c.company_id,dedupeKey:`final_notice_expired:${c.company_id}:${c.final_notice_due_at}`},{resolutionDueAt:due},now),
    ]);
  }
  const overdue=await db.prepare(`SELECT company_id,resolution_due_at FROM onboarding_cases WHERE resolution_due_at<=? AND resolved_at IS NULL`).bind(at).all<{company_id:string;resolution_due_at:string}>();
  const refunds=await db.prepare(`SELECT id,company_id,refund_order_due_at FROM purchase_attempts WHERE status='refund_pending' AND provider_refund_id IS NULL AND refund_order_due_at<=?`).bind(at).all<{id:string;company_id:string;refund_order_due_at:string}>();
  const regularization=await db.prepare(`SELECT id,company_id,regularization_due_at FROM purchase_attempts WHERE status='chargeback_lost' AND regularization_due_at<=? AND chargeback_resolved_at IS NULL`).bind(at).all<{id:string;company_id:string;regularization_due_at:string}>();
  const alerts=[
    ...overdue.results.map(c=>openIncident(db,'onboarding_resolution_overdue','critical',{companyId:c.company_id,dedupeKey:`resolution_overdue:${c.company_id}:${c.resolution_due_at}`},{resolutionDueAt:c.resolution_due_at},now)),
    ...refunds.results.map(r=>openIncident(db,'refund_order_overdue','critical',{companyId:r.company_id,attemptId:r.id,dedupeKey:`refund_overdue:${r.id}`},{refundOrderDueAt:r.refund_order_due_at},now)),
    ...regularization.results.map(r=>openIncident(db,'chargeback_regularization_expired','critical',{companyId:r.company_id,attemptId:r.id,dedupeKey:`regularization_expired:${r.id}`},{regularizationDueAt:r.regularization_due_at},now)),
  ];
  if (alerts.length) await db.batch(alerts);
  return {finalNoticesExpired:expired.results.length,resolutionsOverdue:overdue.results.length,refundOrdersOverdue:refunds.results.length,regularizationsExpired:regularization.results.length};
}
/** Legal terms are set case by case by administration; a term that passes with the request open must be visible. */
export async function sweepLegalRequests(db:D1Database,now=new Date()) {
  const overdue=await db.prepare(`SELECT id,company_id,legal_basis,legal_due_at FROM service_requests WHERE status='requested' AND legal_due_at IS NOT NULL AND legal_due_at<=?`)
    .bind(now.toISOString()).all<{id:string;company_id:string;legal_basis:string;legal_due_at:string}>();
  if (overdue.results.length) await db.batch(overdue.results.map(r=>openIncident(db,'legal_request_overdue','critical',{companyId:r.company_id,dedupeKey:`legal_overdue:${r.id}:${r.legal_due_at}`},{requestId:r.id,legalBasis:r.legal_basis,legalDueAt:r.legal_due_at},now)));
  return {overdue:overdue.results.length};
}
export async function maintenanceSweep(db:D1Database,env:MailEnv&{PUBLIC_BASE_URL?:string},now=new Date()) {
  await db.prepare(`UPDATE founder_invitations SET status='expired' WHERE status='pending' AND expires_at<=?`).bind(now.toISOString()).run();
  await expireStaleHolds(db,now);
  const onboarding=await sweepOnboarding(db,env.PUBLIC_BASE_URL||'',now);
  const legal=await sweepLegalRequests(db,now);
  const cases=await sweepCaseDeadlines(db,now);
  const notifications=await flushNotifications(db,env,now);
  return {onboarding,legal,cases,notifications};
}
/** Fixed-window limiter stored in D1; the upsert is atomic. */
export async function hitRateLimit(db:D1Database,key:string,limit:number,windowSeconds:number,now=new Date()):Promise<boolean> {
  const start=new Date(Math.floor(now.getTime()/(windowSeconds*1000))*windowSeconds*1000).toISOString();
  const row=await db.prepare(`INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END,window_start=excluded.window_start
    RETURNING count`).bind(key,start).first<{count:number}>();
  return (row?.count??0)<=limit;
}
