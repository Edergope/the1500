import { IdentityError } from './identity';

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

export async function getAdminOverview(db:D1Database) {
  const [slots,founders,reviews,invites]=await Promise.all([
    db.prepare(`SELECT phase,status,COUNT(*) AS count FROM slots GROUP BY phase,status`).all(),
    db.prepare(`SELECT COUNT(*) AS count FROM founder_awards WHERE status='active'`).first<{count:number}>(),
    db.prepare(`SELECT COUNT(*) AS count FROM companies WHERE identity_state='pending_review'`).first<{count:number}>(),
    db.prepare(`SELECT COUNT(*) AS count FROM founder_invitations WHERE status='pending' AND expires_at>?`)
      .bind(new Date().toISOString()).first<{count:number}>()
  ]);
  return {capacity:1500,byPhaseAndStatus:slots.results,foundersAssigned:founders?.count??0,
    companiesPendingReview:reviews?.count??0,pendingFounderInvitations:invites?.count??0};
}

export async function reviewCompany(db:D1Database,companyId:string,adminId:string,
  decision:'approved'|'rejected',reasonCode:string,evidenceReference:string,now=new Date()) {
  await requirePlatformAdmin(db,adminId);
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(reasonCode)||!evidenceReference.trim()||evidenceReference.length>400)
    throw new AdminError('REVIEW_EVIDENCE_REQUIRED',400);
  const at=now.toISOString();
  const state=decision==='approved'?'admin_verified':'rejected';
  const results=await db.batch([
    db.prepare(`UPDATE companies SET identity_state=? WHERE id=? AND identity_state='pending_review'`)
      .bind(state,companyId),
    db.prepare(`INSERT INTO admin_review_events(id,company_id,admin_id,decision,reason_code,evidence_reference,decided_at)
      SELECT ?,?,?,?,?,?,? WHERE changes()=1 AND EXISTS(SELECT 1 FROM companies WHERE id=? AND identity_state=?)`)
      .bind(crypto.randomUUID(),companyId,adminId,decision,reasonCode,evidenceReference.trim(),at,companyId,state)
  ]);
  if (results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)
    throw new AdminError('REVIEW_CONFLICT');
  return {companyId,identityState:state,decidedAt:at};
}

/** Manual review queue, always authenticated at the route and never publicly accessible. */
export async function getCompanyReviewQueue(db:D1Database,limit=30) {
  if (!Number.isSafeInteger(limit)||limit<1||limit>50) throw new AdminError('INVALID_LIMIT',400);
  const rows=await db.prepare(`SELECT c.id,c.display_name AS displayName,c.country,c.website,
    c.industry,c.identity_state AS identityState,c.created_at AS createdAt
    FROM companies c WHERE c.identity_state='pending_review'
    ORDER BY c.created_at ASC,c.id ASC LIMIT ?`).bind(limit).all();
  return {companies:rows.results};
}

/** Company must already exist and have an active owner; invitation is visible in owner's account. */
export async function inviteFounder(db:D1Database,adminId:string,companyId:string,now=new Date()) {
  await requirePlatformAdmin(db,adminId);
  const company=await db.prepare(`SELECT c.identity_state,c.publication_status,
    (SELECT COUNT(*) FROM memberships m WHERE m.company_id=c.id AND m.role='owner') AS owners,
    (SELECT COUNT(*) FROM slots s WHERE s.company_id=c.id AND s.status IN('assigned','retired')) AS assigned
    FROM companies c WHERE c.id=?`).bind(companyId)
    .first<{identity_state:string;publication_status:string;owners:number;assigned:number}>();
  if (!company||!['self_declared','admin_verified'].includes(company.identity_state)||company.owners<1)
    throw new AdminError('FOUNDER_COMPANY_NOT_ELIGIBLE',403);
  if (company.assigned) throw new AdminError('COMPANY_ALREADY_ASSIGNED');
  const free=await db.prepare(`SELECT 1 AS ok FROM slots WHERE number BETWEEN 1 AND 100 AND status='available' LIMIT 1`)
    .first<{ok:number}>();
  if (!free) throw new AdminError('FOUNDER_INVENTORY_EXHAUSTED');
  const nowIso=now.toISOString();
  // Expired invitations are closed before applying the pending uniqueness constraint.
  await db.prepare(`UPDATE founder_invitations SET status='expired'
    WHERE status='pending' AND expires_at<=?`).bind(nowIso).run();
  const id=crypto.randomUUID();const expiration=new Date(now.getTime()+founderInviteMs).toISOString();
  try {
    await db.prepare(`INSERT INTO founder_invitations(id,company_id,invited_by,created_at,expires_at)
      VALUES(?,?,?,?,?)`).bind(id,companyId,adminId,nowIso,expiration).run();
  } catch {throw new AdminError('FOUNDER_INVITATION_EXISTS');}
  return {invitationId:id,companyId,status:'pending',expiresAt:expiration,
    delivery:'owner_portal',emailDeliveryEnabled:false};
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

/** A founder invitation is accepted by its company owner, NEVER by an unauthenticated token. */
export async function acceptFounderInvitation(db:D1Database,invitationId:string,userId:string,now=new Date()) {
  const invite=await db.prepare(`SELECT fi.id,fi.company_id,fi.status,fi.expires_at
    FROM founder_invitations fi JOIN memberships m ON m.company_id=fi.company_id
    WHERE fi.id=? AND m.user_id=? AND m.role='owner'`).bind(invitationId,userId)
    .first<FounderInviteRow>();
  if (!invite) throw new AdminError('INVITATION_NOT_FOUND',404);
  if (invite.status!=='pending'||invite.expires_at<=now.toISOString())
    throw new AdminError('INVITATION_EXPIRED');
  const slot=await db.prepare(`SELECT number FROM slots WHERE number BETWEEN 1 AND 100
    AND status='available' ORDER BY number LIMIT 1`).first<{number:number}>();
  if (!slot) throw new AdminError('FOUNDER_INVENTORY_EXHAUSTED');
  const at=now.toISOString(), awardId=crypto.randomUUID();
  try {
    const result=await db.batch([
      db.prepare(`UPDATE slots SET status='assigned',company_id=?,assignment_kind='founder'
        WHERE number=? AND status='available'
        AND NOT EXISTS(SELECT 1 FROM slots s WHERE s.company_id=? AND s.status IN('assigned','retired'))
        AND EXISTS(SELECT 1 FROM founder_invitations fi WHERE fi.id=? AND fi.company_id=?
        AND fi.status='pending' AND fi.expires_at>?)`)
        .bind(invite.company_id,slot.number,invite.company_id,invite.id,invite.company_id,at),
      db.prepare(`INSERT INTO founder_awards(id,slot_number,company_id,approved_by,status,awarded_at)
        SELECT ?,s.number,?,fi.invited_by,'active',? FROM slots s
        JOIN founder_invitations fi ON fi.id=? WHERE s.number=?
        AND s.company_id=? AND s.status='assigned' AND s.assignment_kind='founder'
        AND fi.status='pending' AND fi.expires_at>?`)
        .bind(awardId,invite.company_id,at,invite.id,slot.number,invite.company_id,at),
      db.prepare(`UPDATE founder_invitations SET status='accepted',accepted_at=?,accepted_by=?
        WHERE id=? AND status='pending' AND expires_at>?
        AND EXISTS(SELECT 1 FROM founder_awards WHERE id=?)`)
        .bind(at,userId,invite.id,at,awardId),
      db.prepare(`INSERT INTO slot_audit(event_id,slot_number,action,company_id,reference_id,occurred_at)
        SELECT ?,s.number,'assign_founder',s.company_id,?,? FROM slots s
        WHERE s.number=? AND s.status='assigned' AND s.company_id=?
        AND EXISTS(SELECT 1 FROM founder_awards WHERE id=?)`)
        .bind(crypto.randomUUID(),awardId,at,slot.number,invite.company_id,awardId)
    ]);
    if (result.some(x=>x?.meta?.changes!==1)) throw new AdminError('FOUNDER_ASSIGNMENT_CONFLICT');
  } catch(e) {if (e instanceof AdminError) throw e;throw new AdminError('FOUNDER_ASSIGNMENT_CONFLICT');}
  return {companyId:invite.company_id,slotNumber:slot.number,status:'assigned',assignmentKind:'founder'};
}
