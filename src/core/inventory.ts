import type { HoldReceipt, InventoryFailureCode, SlotPhase } from '../lib/contracts/inventory';

const HOLD_MS = 20 * 60 * 1000;
export class InventoryError extends Error {
  constructor(public readonly code: InventoryFailureCode, message: string) {
    super(message); this.name='InventoryError';
  }
}
interface Candidate { number: number; phase: SlotPhase; price_usd_cents: number; }
interface ActiveHold {
  id: string; slot_number: number; company_id:string; phase: SlotPhase;
  price_usd_cents: number; created_at: string; expires_at: string; status: string;
}

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
  const existing=await db.prepare(`SELECT h.id,h.slot_number,h.company_id,h.created_at,h.expires_at,h.status,
    s.phase,s.price_usd_cents FROM slot_holds h JOIN slots s ON s.number=h.slot_number
    WHERE h.user_id=? AND h.idempotency_key=?`).bind(userId,idempotencyKey).first<ActiveHold>();
  if (existing) {
    if (existing.company_id!==companyId) throw new InventoryError('IDEMPOTENCY_MISMATCH','Key belongs to another company');
    if (existing.status!=='active'|| existing.expires_at<=now.toISOString())
      throw new InventoryError('HOLD_EXPIRED','Previously reserved hold is no longer active');
    return receipt(existing);
  }
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
  const phase=await currentPhase(db);
  if (phase===null) throw new InventoryError('INVENTORY_UNAVAILABLE','No free positions');
  if (phase===4) throw new InventoryError('PHASE_PENDING','Premium admission is manual');
  // Slot numbers 1..100 are reserved for invited free founders. Their availability
  // prevents phase II from opening, but they can never be checked out as paid slots.
  const row=await db.prepare(`SELECT number,phase,price_usd_cents FROM slots
    WHERE phase=? AND status='available' AND number>100
    ORDER BY number LIMIT 1`).bind(phase).first<Candidate>();
  if (!row) throw new InventoryError('PHASE_PENDING','Current phase is not confirmed exhausted');
  const id=crypto.randomUUID(), at=now.toISOString(),expiresAt=new Date(now.getTime()+HOLD_MS).toISOString();
  try {
    // batch() is atomic in D1. Both inserts depend on compare-and-swap state.
    await db.batch([
      db.prepare(`UPDATE slots SET status='held',active_hold_id=?,held_until=?
        WHERE number=? AND status='available' AND phase=(SELECT MIN(phase)
        FROM slots WHERE status IN ('available','held'))
        AND NOT EXISTS(SELECT 1 FROM slots s2 WHERE s2.company_id=? AND s2.status IN ('assigned','retired'))`)
        .bind(id,expiresAt,row.number,companyId),
      db.prepare(`INSERT INTO slot_holds(id,slot_number,company_id,user_id,idempotency_key,status,created_at,expires_at)
        SELECT ?,number,?,?,?,'active',?,? FROM slots
        WHERE number=? AND status='held' AND active_hold_id=?`)
        .bind(id,companyId,userId,idempotencyKey,at,expiresAt,row.number,id),
      db.prepare(`INSERT INTO slot_audit(event_id,slot_number,action,company_id,reference_id,occurred_at)
        SELECT ?,number,'hold',?,?,? FROM slots WHERE number=? AND status='held' AND active_hold_id=?`)
        .bind(crypto.randomUUID(),companyId,id,at,row.number,id)
    ]);
  } catch { throw new InventoryError('SLOT_CONFLICT','Position changed; retry with a fresh idempotency key'); }
  const saved=await db.prepare(`SELECT h.id,h.slot_number,h.company_id,h.created_at,h.expires_at,h.status,
    s.phase,s.price_usd_cents FROM slot_holds h JOIN slots s ON s.number=h.slot_number
    WHERE h.id=? AND h.status='active' AND s.active_hold_id=h.id`).bind(id).first<ActiveHold>();
  if (!saved) throw new InventoryError('SLOT_CONFLICT','Position unavailable; retry');
  return receipt(saved);
}
function receipt(h:ActiveHold):HoldReceipt {
  return {holdId:h.id,slotNumber:h.slot_number,phase:h.phase as Exclude<SlotPhase,4>,
    priceUsdCents:h.price_usd_cents,createdAt:h.created_at,expiresAt:h.expires_at,status:'active'};
}
export async function currentPhase(db:D1Database):Promise<SlotPhase|null> {
  const row=await db.prepare(`SELECT MIN(phase) AS phase FROM slots WHERE status IN('available','held')`)
    .first<{phase:SlotPhase|null}>();
  return row?.phase??null;
}
