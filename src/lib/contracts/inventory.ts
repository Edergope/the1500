export interface InventorySummary {
  capacity: 1500;
  occupied: number;
  held: number;
  available: number;
  published: number;
  sectorsRepresented: number;
  currentPhase: 1 | 2 | 3 | 4 | null;
}
export type SlotPhase = 1 | 2 | 3 | 4;
export type InventoryFailureCode =
  | 'INVENTORY_UNAVAILABLE' | 'PHASE_PENDING' | 'SLOT_CONFLICT'
  | 'INVALID_COMPANY' | 'UNAUTHORIZED' | 'INVALID_IDEMPOTENCY_KEY'
  | 'IDEMPOTENCY_MISMATCH' | 'HOLD_EXPIRED' | 'ACTIVE_HOLD_EXISTS'
  | 'ALREADY_ALLOCATED' | 'TOO_MANY_REQUESTS' | 'COMPANY_REVIEW_REQUIRED';
export interface HoldReceipt {
  holdId:string; slotNumber:number; phase:1|2|3; priceUsdCents:number;
  createdAt:string; expiresAt:string; status:'active';
}
export interface ApiFailure {error:{code:InventoryFailureCode|string;message?:string;requestId?:string}};
