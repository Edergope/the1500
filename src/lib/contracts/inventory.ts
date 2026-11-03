export type SlotPhase = 1 | 2 | 3 | 4;
/** closed_archive: no valid positions remain. Directory stays readable, nothing can be bought. */
export type SalesMode = 'selling' | 'awaiting_founder_allocation' | 'premium_admission' | 'closed_archive';
export interface PhaseSummary {
  phase:SlotPhase;firstPosition:number;lastPosition:number;priceUsdCents:number;
  remaining:number;status:'sold_out'|'current'|'upcoming';
}
export interface InventorySummary {
  capacity: 1500;
  occupied: number;
  held: number;
  available: number;
  retired: number;
  published: number;
  sectorsRepresented: number;
  currentPhase: SlotPhase | null;
  currentPriceUsdCents: number | null;
  salesMode: SalesMode;
  checkoutOpen: boolean;
  phases: PhaseSummary[];
}
export type InventoryFailureCode =
  | 'SALES_CLOSED' | 'PHASE_PENDING' | 'SLOT_CONFLICT' | 'PREMIUM_ADMISSION_REQUIRED'
  | 'PAID_CAPACITY_PENDING_FOUNDERS' | 'INVALID_COMPANY' | 'UNAUTHORIZED' | 'INVALID_IDEMPOTENCY_KEY'
  | 'IDEMPOTENCY_MISMATCH' | 'HOLD_EXPIRED' | 'HOLD_NOT_FOUND' | 'ACTIVE_HOLD_EXISTS'
  | 'ALREADY_ALLOCATED' | 'TOO_MANY_REQUESTS' | 'COMPANY_REVIEW_REQUIRED';
/** Position numbers are assigned on confirmation (Decision 30), so a hold never exposes one. */
export interface HoldReceipt {
  holdId:string; phase:1|2|3; priceUsdCents:number;
  createdAt:string; expiresAt:string; status:'active';
}
export interface ApiFailure {error:{code:InventoryFailureCode|string;message?:string;locale?:string}};
