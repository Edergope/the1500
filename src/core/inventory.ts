import type { HoldReceipt, InventoryFailureCode, SalesMode, SlotPhase } from '../lib/contracts/inventory';
import { IdentityError } from './identity';

const HOLD_MS = 20 * 60 * 1000;
export const FOUNDER_PLACES = 100;
/** Owner decision 2026-11-03: founders hold exactly 1-100. Checkout only ever touches 101 and above. */
export const FIRST_PAID_NUMBER = 101;
const CONFLICT_STATUS:Partial<Record<InventoryFailureCode,number>>={UNAUTHORIZED:401,TOO_MANY_REQUESTS:429,
  INVALID_COMPANY:400,INVALID_IDEMPOTENCY_KEY:400,HOLD_NOT_FOUND:404};
export class InventoryError extends IdentityError {
  constructor(code: InventoryFailureCode, message?: string) {
    super(code, CONFLICT_STATUS[code]??409);
    if (message) this.message=message;
    this.name='InventoryError';
  }
}
interface ActiveHold {
  id: string; slot_number: number; company_id:string; phase: SlotPhase;
  price_usd_cents: number; created_at: string; expires_at: string; status: string;
}
const CURRENT_PHASE=`(SELECT MIN(phase) FROM slots WHERE status IN('available','held'))`;

/** Sweeps expired holds atomically, preserving append-only slot history. */
export async function expireStaleHolds(db: D1Database, now: Date): Promise<void> {
  const time=now.toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO slot_audit(event_id,slot_number,action,company_id,reference_id,occurred_at)
      SELECT 'expire:' || h.id, h.slot_number, 'expire', h.company_id, h.id, ?
      FROM slot_holds h JOIN slots s ON s.number=h.slot_number
      WHERE h.status='active' AND h.expires_at<=? AND s.status='held'
      AND s.active_hold_id=h.id`).bind(time,time),
    db.prepare(`UPDATE slot_holds SET status='expired' WHERE status='active' AND expires_at<=?
      AND EXISTS(SELECT 1 FROM slots s WHERE s.number=slot_holds.slot_number
      AND s.status='held' AND s.active_hold_id=slot_holds.id)`).bind(time),
    db.prepare(`UPDATE slots SET status='available',active_hold_id=NULL,held_until=NULL
      WHERE status='held' AND held_until<=? AND NOT EXISTS(
      SELECT 1 FROM slot_holds h WHERE h.id=slots.active_hold_id AND h.status='active')`).bind(time),
    // If a slot has lost its active hold for any reason, close orphan rows rather than
    // keeping historical rows in active status forever.
    db.prepare(`UPDATE slot_holds SET status='expired' WHERE status='active' AND expires_at<=?
      AND NOT EXISTS(SELECT 1 FROM slots s WHERE s.active_hold_id=slot_holds.id
      AND s.status='held')`).bind(time)
  ]);
}

export interface SalesState {
  mode:SalesMode; currentPhase:SlotPhase|null; priceUsdCents:number|null; checkoutOpen:boolean;
}
export async function getSalesState(db:D1Database):Promise<SalesState> {
  // Each subquery stops at its first index entry, so the cost does not grow with the inventory.
  // Founder places are all in phase 1 (schema CHECK); filtering by it keeps the seek on idx_slots_phase_open.
  const row=await db.prepare(`WITH a(p) AS (SELECT phase FROM slots WHERE status='available' ORDER BY phase LIMIT 1),
      h(p) AS (SELECT phase FROM slots WHERE status='held' ORDER BY phase LIMIT 1),
      c(p) AS (SELECT MIN(p) FROM (SELECT p FROM a UNION ALL SELECT p FROM h))
    SELECT c.p AS phase,(SELECT price_usd_cents FROM slots WHERE phase=c.p LIMIT 1) AS price,
      EXISTS(SELECT 1 FROM slots WHERE phase=1 AND status='available' AND number>=${FIRST_PAID_NUMBER}) AS paid_free,
      EXISTS(SELECT 1 FROM slots WHERE phase=1 AND status='available' AND number<${FIRST_PAID_NUMBER}) AS founder_free FROM c`)
    .first<{phase:SlotPhase|null;paid_free:number;price:number|null;founder_free:number}>();
  const phase=row?.phase??null;
  if (phase===null) return {mode:'closed_archive',currentPhase:null,priceUsdCents:null,checkoutOpen:false};
  if (phase===4) return {mode:'premium_admission',currentPhase:4,priceUsdCents:row!.price,checkoutOpen:false};
  if (phase===1&&row!.paid_free===0&&row!.founder_free>0)
    return {mode:'awaiting_founder_allocation',currentPhase:1,priceUsdCents:row!.price,checkoutOpen:false};
  return {mode:'selling',currentPhase:phase,priceUsdCents:row!.price,checkoutOpen:true};
}
export async function currentPhase(db:D1Database):Promise<SlotPhase|null> {
  return (await getSalesState(db)).currentPhase;
}

/**
 * Server-only call. Requires pre-validated authenticated owner, and the route must
 * validate CSRF and idempotency input. Never accept client price or slot number.
 */
export async function createCheckoutHold(
  db:D1Database, companyId:string, userId:string, idempotencyKey:string, now=new Date()
): Promise<HoldReceipt> {
  if (!companyId.trim()) throw new InventoryError('INVALID_COMPANY','Company required');
  if (!userId.trim()) throw new InventoryError('UNAUTHORIZED','User required');
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(idempotencyKey))
    throw new InventoryError('INVALID_IDEMPOTENCY_KEY','Valid idempotency key required');
  await expireStaleHolds(db,now);
  const existing=await findHoldByKey(db,userId,idempotencyKey);
  if (existing) return replayHold(existing,companyId,now);
  const company=await db.prepare(`SELECT identity_state FROM companies WHERE id=?`).bind(companyId)
    .first<{identity_state:string}>();
  if (!company) throw new InventoryError('INVALID_COMPANY','Company not found');
  if (!['self_declared','admin_verified'].includes(company.identity_state))
    throw new InventoryError('COMPANY_REVIEW_REQUIRED','Company identity needs review');
  const allocated=await db.prepare(`SELECT number FROM slots WHERE company_id=?
    AND status IN('assigned','retired') LIMIT 1`).bind(companyId).first<{number:number}>();
  if (allocated) throw new InventoryError('ALREADY_ALLOCATED','Company already has a position');
  const existingActive=await db.prepare(`SELECT id FROM slot_holds WHERE company_id=? AND status='active'`)
    .bind(companyId).first<{id:string}>();
  if (existingActive) throw new InventoryError('ACTIVE_HOLD_EXISTS','Company already has a hold');
  const recent=await db.prepare(`SELECT COUNT(*) AS total FROM slot_holds WHERE user_id=? AND created_at>?`)
    .bind(userId,new Date(now.getTime()-10*60_000).toISOString()).first<{total:number}>();
  if ((recent?.total??0)>=4) throw new InventoryError('TOO_MANY_REQUESTS','Hold rate limit');
  const sales=await getSalesState(db);
  if (sales.mode==='closed_archive') throw new InventoryError('SALES_CLOSED','No positions remain');
  if (sales.mode==='premium_admission') throw new InventoryError('PREMIUM_ADMISSION_REQUIRED','Premium admission is manual');
  if (sales.mode==='awaiting_founder_allocation') throw new InventoryError('PAID_CAPACITY_PENDING_FOUNDERS','Paid tier 1 sold out');
  const id=crypto.randomUUID(), at=now.toISOString(),expiresAt=new Date(now.getTime()+HOLD_MS).toISOString();
  let results:D1Result[];
  try {
    // One statement chooses and takes the lowest free number, so concurrent buyers receive
    // different positions instead of failing against a number read a moment earlier.
    results=await db.batch([
      db.prepare(`UPDATE slots SET status='held',active_hold_id=?,held_until=?
        WHERE number=(SELECT MIN(s.number) FROM slots s WHERE s.status='available' AND s.number>=${FIRST_PAID_NUMBER} AND s.phase=${CURRENT_PHASE})
        AND phase<4
        AND NOT EXISTS(SELECT 1 FROM slots s2 WHERE s2.company_id=? AND s2.status IN ('assigned','retired'))`)
        .bind(id,expiresAt,companyId),
      db.prepare(`INSERT INTO slot_holds(id,slot_number,company_id,user_id,idempotency_key,status,created_at,expires_at)
        SELECT ?,number,?,?,?,'active',?,? FROM slots WHERE active_hold_id=?`)
        .bind(id,companyId,userId,idempotencyKey,at,expiresAt,id),
      db.prepare(`INSERT INTO slot_audit(event_id,slot_number,action,company_id,reference_id,occurred_at)
        SELECT ?,number,'hold',?,?,? FROM slots WHERE active_hold_id=?`)
        .bind(crypto.randomUUID(),companyId,id,at,id)
    ]);
  } catch {
    // A unique index rejected the batch: same key replayed, or a parallel hold for this company.
    const raced=await findHoldByKey(db,userId,idempotencyKey);
    if (raced) return replayHold(raced,companyId,now);
    const active=await db.prepare(`SELECT id FROM slot_holds WHERE company_id=? AND status='active'`)
      .bind(companyId).first<{id:string}>();
    if (active) throw new InventoryError('ACTIVE_HOLD_EXISTS','Company already has a hold');
    throw new InventoryError('SLOT_CONFLICT','Position changed; retry');
  }
  // The statement touches one row at most (a primary key). D1 also counts what triggers write, so this asks for any change, not exactly one.
  if (!results[0]?.meta?.changes) {
    const state=await getSalesState(db);
    if (state.mode==='closed_archive') throw new InventoryError('SALES_CLOSED');
    if (state.mode==='premium_admission') throw new InventoryError('PREMIUM_ADMISSION_REQUIRED');
    if (state.mode==='awaiting_founder_allocation') throw new InventoryError('PAID_CAPACITY_PENDING_FOUNDERS');
    throw new InventoryError('PHASE_PENDING','All free positions are currently reserved');
  }
  const saved=await db.prepare(`SELECT h.id,h.slot_number,h.company_id,h.created_at,h.expires_at,h.status,
    s.phase,s.price_usd_cents FROM slot_holds h JOIN slots s ON s.number=h.slot_number
    WHERE h.id=?`).bind(id).first<ActiveHold>();
  if (!saved) throw new InventoryError('SLOT_CONFLICT','Position unavailable; retry');
  return receipt(saved);
}
async function findHoldByKey(db:D1Database,userId:string,key:string) {
  return db.prepare(`SELECT h.id,h.slot_number,h.company_id,h.created_at,h.expires_at,h.status,
    s.phase,s.price_usd_cents FROM slot_holds h JOIN slots s ON s.number=h.slot_number
    WHERE h.user_id=? AND h.idempotency_key=?`).bind(userId,key).first<ActiveHold>();
}
function replayHold(h:ActiveHold,companyId:string,now:Date):HoldReceipt {
  if (h.company_id!==companyId) throw new InventoryError('IDEMPOTENCY_MISMATCH','Key belongs to another company');
  if (h.status!=='active'||h.expires_at<=now.toISOString())
    throw new InventoryError('HOLD_EXPIRED','Previously reserved hold is no longer active');
  return receipt(h);
}
function receipt(h:ActiveHold):HoldReceipt {
  return {holdId:h.id,phase:h.phase as Exclude<SlotPhase,4>,
    priceUsdCents:h.price_usd_cents,createdAt:h.created_at,expiresAt:h.expires_at,status:'active'};
}

export interface LiveHold extends ActiveHold {user_id:string|null;}
export async function getHold(db:D1Database,holdId:string):Promise<LiveHold|null> {
  return db.prepare(`SELECT h.id,h.slot_number,h.company_id,h.user_id,h.created_at,h.expires_at,h.status,
    s.phase,s.price_usd_cents FROM slot_holds h JOIN slots s ON s.number=h.slot_number WHERE h.id=?`)
    .bind(holdId).first<LiveHold>();
}
export async function releaseHold(db:D1Database,holdId:string,now=new Date()):Promise<void> {
  const at=now.toISOString();
  await db.batch([
    db.prepare(`INSERT INTO slot_audit(event_id,slot_number,action,company_id,reference_id,occurred_at)
      SELECT ?,h.slot_number,'release',h.company_id,h.id,? FROM slot_holds h WHERE h.id=? AND h.status='active'`)
      .bind(crypto.randomUUID(),at,holdId),
    db.prepare(`UPDATE slots SET status='available',active_hold_id=NULL,held_until=NULL WHERE active_hold_id=? AND status='held'`).bind(holdId),
    db.prepare(`UPDATE slot_holds SET status='released' WHERE id=? AND status='active'`).bind(holdId),
  ]);
}

/** Decisions 19, 34: the onboarding clock starts on confirmed purchase or formal award. */
export function onboardingStart(db:D1Database,companyId:string,origin:'paid'|'founder'|'premium',now:Date,guardSql='1',...guardArgs:unknown[]) {
  const day=(n:number)=>new Date(now.getTime()+n*86_400_000).toISOString();
  return db.prepare(`INSERT OR IGNORE INTO onboarding_cases(company_id,origin,started_at,form_due_at,extension_due_at,reactivation_due_at)
    SELECT ?,?,?,?,?,? WHERE ${guardSql}`)
    .bind(companyId,origin,now.toISOString(),day(15),day(30),day(45),...guardArgs);
}

export interface ConfirmResult {outcome:'assigned'|'hold_not_active'|'already_processed';slotNumber?:number;}
/**
 * Converts a live hold into a definitive assignment. Decisions 30-31: the number goes to whoever
 * confirms first, so this takes the lowest paid number still free or reserved in the tier. The slot this
 * hold was pinned to goes back to the pool, or to the hold that was sitting on that lower number.
 * All of it runs as one D1 transaction, so concurrent confirmations queue instead of conflicting.
 */
export async function convertHold(db:D1Database,attemptId:string,now=new Date(),paidFields:{paymentIntent:string|null;payerEmail:string|null}={paymentIntent:null,payerEmail:null}):Promise<ConfirmResult> {
  const at=now.toISOString();
  const row=await db.prepare(`SELECT a.status,a.company_id,a.hold_id,a.phase FROM purchase_attempts a WHERE a.id=?`).bind(attemptId)
    .first<{status:string;company_id:string;hold_id:string;phase:number}>();
  if (!row) return {outcome:'hold_not_active'};
  if (!['creating','pending'].includes(row.status)) return {outcome:'already_processed'};
  // Marks this run, so that a repeated confirmation cannot re-apply the statements after the first.
  const run=crypto.randomUUID();
  const mine=`EXISTS(SELECT 1 FROM purchase_attempts WHERE id='${attemptId.replace(/'/g,"''")}' AND settlement_id='${run}')`;
  const T=`(SELECT assigned_slot_number FROM purchase_attempts WHERE id='${attemptId.replace(/'/g,"''")}')`;
  const M=`(SELECT provisional_slot_number FROM purchase_attempts WHERE id='${attemptId.replace(/'/g,"''")}')`;
  const results=await db.batch([
    db.prepare(`UPDATE purchase_attempts SET status='paid',settlement_id=?,paid_at=?,updated_at=?,
        provisional_slot_number=(SELECT slot_number FROM slot_holds WHERE id=?),
        assigned_slot_number=(SELECT MIN(number) FROM slots WHERE phase=? AND number>=${FIRST_PAID_NUMBER} AND status IN('available','held')),
        provider_payment_intent=COALESCE(?,provider_payment_intent),payer_email=COALESCE(?,payer_email)
      WHERE id=? AND status IN('creating','pending')
      AND EXISTS(SELECT 1 FROM slot_holds h JOIN slots s ON s.active_hold_id=h.id AND s.number=h.slot_number
        WHERE h.id=? AND h.status='active' AND h.expires_at>?)`)
      .bind(run,at,at,row.hold_id,row.phase,paidFields.paymentIntent,paidFields.payerEmail,attemptId,row.hold_id,at),
    db.prepare(`UPDATE slot_holds SET status='converted',slot_number=${T} WHERE id=? AND ${mine}`).bind(row.hold_id),
    db.prepare(`INSERT INTO slot_audit(event_id,slot_number,action,company_id,reference_id,occurred_at)
      SELECT ?,${M},'hold_moved',company_id,id,? FROM slot_holds WHERE id=(SELECT active_hold_id FROM slots WHERE number=${T}) AND id<>? AND status='active' AND ${mine}`)
      .bind(crypto.randomUUID(),at,row.hold_id),
    db.prepare(`UPDATE slot_holds SET slot_number=${M} WHERE id=(SELECT active_hold_id FROM slots WHERE number=${T}) AND id<>? AND status='active' AND ${mine}`).bind(row.hold_id),
    db.prepare(`UPDATE slots SET status='assigned',company_id=?,assignment_kind='paid',active_hold_id=NULL,held_until=NULL,assigned_at=? WHERE number=${T} AND ${mine}`).bind(row.company_id,at),
    db.prepare(`UPDATE slots SET active_hold_id=(SELECT id FROM slot_holds WHERE slot_number=${M} AND status='active'),
        held_until=(SELECT expires_at FROM slot_holds WHERE slot_number=${M} AND status='active'),
        status=CASE WHEN EXISTS(SELECT 1 FROM slot_holds WHERE slot_number=${M} AND status='active') THEN 'held' ELSE 'available' END
      WHERE number=${M} AND number<>${T} AND ${mine}`),
    db.prepare(`INSERT INTO slot_audit(event_id,slot_number,action,company_id,reference_id,occurred_at)
      SELECT ?,${T},'assign_paid',?,?,? WHERE ${mine}`).bind(crypto.randomUUID(),row.company_id,attemptId,at),
    onboardingStart(db,row.company_id,'paid',now,mine),
  ]);
  if (results[0]?.meta?.changes!==1) {
    const after=await db.prepare(`SELECT status FROM purchase_attempts WHERE id=?`).bind(attemptId).first<{status:string}>();
    return {outcome:after&&!['creating','pending'].includes(after.status)?'already_processed':'hold_not_active'};
  }
  const assigned=await db.prepare(`SELECT assigned_slot_number AS n FROM purchase_attempts WHERE id=?`).bind(attemptId).first<{n:number}>();
  return {outcome:'assigned',slotNumber:assigned!.n};
}

/** Used for reconciled late payments: the original tier and price, or nothing. Decisions 42, 44. */
export async function assignFreeSlotInPhase(db:D1Database,attemptId:string,companyId:string,phase:number,now=new Date()):Promise<number|null> {
  const at=now.toISOString();
  const pick=`(SELECT MIN(number) FROM slots WHERE phase=? AND number>=${FIRST_PAID_NUMBER} AND status='available')`;
  const results=await db.batch([
    db.prepare(`UPDATE purchase_attempts SET status='paid',assigned_slot_number=${pick},updated_at=?
      WHERE id=? AND status='late_review' AND ${pick} IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM slots WHERE company_id=? AND status IN('assigned','retired'))`)
      .bind(phase,at,attemptId,phase,companyId),
    db.prepare(`UPDATE slots SET status='assigned',company_id=?,assignment_kind='paid',assigned_at=?
      WHERE number=(SELECT assigned_slot_number FROM purchase_attempts WHERE id=? AND status='paid') AND status='available'`)
      .bind(companyId,at,attemptId),
    db.prepare(`INSERT INTO slot_audit(event_id,slot_number,action,company_id,reference_id,occurred_at,metadata_json)
      SELECT ?,assigned_slot_number,'assign_paid',?,?,?,'{"late":true}' FROM purchase_attempts WHERE id=? AND status='paid'`)
      .bind(crypto.randomUUID(),companyId,attemptId,at,attemptId),
    onboardingStart(db,companyId,'paid',now,`EXISTS(SELECT 1 FROM purchase_attempts WHERE id=? AND status='paid')`,attemptId),
  ]);
  if (results[0]?.meta?.changes!==1) return null;
  const row=await db.prepare(`SELECT assigned_slot_number AS n FROM purchase_attempts WHERE id=?`).bind(attemptId).first<{n:number}>();
  return row?.n??null;
}

/** Returns a confirmed position to inventory. Never succeeds once it has been published (Decisions 17, 18, 30). */
export function releaseAssignmentStatements(db:D1Database,slotNumber:number,companyId:string,action:'refund_release'|'revoke_founder',reference:string,now:Date) {
  const at=now.toISOString();
  return [
    db.prepare(`INSERT INTO slot_audit(event_id,slot_number,action,company_id,reference_id,occurred_at)
      SELECT ?,number,?,?,?,? FROM slots WHERE number=? AND company_id=? AND status='assigned' AND first_published_at IS NULL`)
      .bind(crypto.randomUUID(),action,companyId,reference,at,slotNumber,companyId),
    db.prepare(`UPDATE slots SET status='available',company_id=NULL,assignment_kind=NULL,assigned_at=NULL
      WHERE number=? AND company_id=? AND status='assigned' AND first_published_at IS NULL`).bind(slotNumber,companyId),
    db.prepare(`UPDATE onboarding_cases SET status='cancelled' WHERE company_id=? AND status<>'completed'`).bind(companyId),
  ];
}
