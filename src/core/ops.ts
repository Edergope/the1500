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
/** Sends what is queued. Nothing is marked sent unless the provider accepted it. */
export async function flushNotifications(db:D1Database,env:MailEnv,now=new Date(),limit=20):Promise<{sent:number;failed:number;skipped:boolean}> {
  if (!mailConfigured(env)) return {sent:0,failed:0,skipped:true};
  const pending=await db.prepare(`SELECT id,kind,company_id,recipient,subject,body,attempts FROM notifications WHERE status='pending' ORDER BY created_at LIMIT ?`)
    .bind(limit).all<{id:string;kind:string;company_id:string|null;recipient:string;subject:string;body:string;attempts:number}>();
  let sent=0,failed=0;
  for (const n of pending.results) {
    const ok=await sendMail(env,{to:n.recipient,subject:n.subject,text:n.body});
    if (ok) {
      sent++;await db.prepare(`UPDATE notifications SET status='sent',sent_at=?,attempts=attempts+1 WHERE id=?`).bind(now.toISOString(),n.id).run();
      if (n.kind==='reactivation_approved'&&n.company_id) await startReactivationClock(db,n.company_id,now).run();
    } else {
      failed++;await db.prepare(`UPDATE notifications SET attempts=attempts+1,status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END WHERE id=?`).bind(n.id).run();
      if (n.attempts>=4) await openIncident(db,'notification_failed','warning',{companyId:n.company_id,dedupeKey:`notification_failed:${n.id}`},{kind:n.kind},now).run();
    }
  }
  return {sent,failed,skipped:false};
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
      db.prepare(`UPDATE onboarding_cases SET status='admin_review',admin_review_at=? WHERE company_id=? AND status='reactivated'`).bind(at,c.company_id),
      openIncident(db,'onboarding_reactivation_lapsed','warning',{companyId:c.company_id,dedupeKey:`onboarding_reactivation_lapsed:${c.company_id}:${at}`},{note:'Individual review. The position and the money are not lost automatically.'},now),
    ]);
    await notifyOwners(db,c.company_id,'onboarding_reactivation_lapsed',l=>reactivationEmail(l,'lapsed',baseUrl),`onboarding_reactivation_lapsed:${c.company_id}:${at}`,now);
    moved.reactivationLapsed++;
  }
  return moved;
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
  const notifications=await flushNotifications(db,env,now);
  return {onboarding,legal,notifications};
}
/** Fixed-window limiter stored in D1; the upsert is atomic. */
export async function hitRateLimit(db:D1Database,key:string,limit:number,windowSeconds:number,now=new Date()):Promise<boolean> {
  const start=new Date(Math.floor(now.getTime()/(windowSeconds*1000))*windowSeconds*1000).toISOString();
  const row=await db.prepare(`INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END,window_start=excluded.window_start
    RETURNING count`).bind(key,start).first<{count:number}>();
  return (row?.count??0)<=limit;
}
