import type {InventorySummary,PhaseSummary,SlotPhase} from '../lib/contracts/inventory';
import {getSalesState} from './inventory';
export type PublicStats=InventorySummary;
const RANGES:Record<SlotPhase,[number,number,number]>={1:[1,600,10000],2:[601,1050,40000],3:[1051,1350,100000],4:[1351,1500,506600]};

/** Every number comes from the database; nothing here is estimated. */
export async function getPublicStats(db: D1Database): Promise<PublicStats> {
  const [slotCounts, phases, publishedRows, sectors, sales] = await Promise.all([
    db.prepare(`SELECT
      SUM(CASE WHEN status IN ('assigned','retired') THEN 1 ELSE 0 END) occupied,
      SUM(CASE WHEN status='held' THEN 1 ELSE 0 END) held,
      SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) available,
      SUM(CASE WHEN status='retired' THEN 1 ELSE 0 END) retired,
      COUNT(*) capacity
    FROM slots`).first<{occupied:number;held:number;available:number;retired:number;capacity:number}>(),
    db.prepare(`SELECT phase,SUM(CASE WHEN status IN('available','held') THEN 1 ELSE 0 END) remaining FROM slots GROUP BY phase ORDER BY phase`)
      .all<{phase:SlotPhase;remaining:number}>(),
    db.prepare("SELECT COUNT(*) total FROM companies WHERE publication_status='published'").first<{ total: number }>(),
    db.prepare("SELECT COUNT(DISTINCT industry) total FROM companies WHERE publication_status='published' AND industry IS NOT NULL").first<{ total: number }>(),
    getSalesState(db),
  ]);
  if (!slotCounts || slotCounts.capacity !== 1500) throw new Error('Inventory integrity check failed');
  const summaries:PhaseSummary[]=phases.results.map(p=>{
    const [firstPosition,lastPosition,priceUsdCents]=RANGES[p.phase];
    return {phase:p.phase,firstPosition,lastPosition,priceUsdCents,remaining:p.remaining,
      status:p.phase===sales.currentPhase?'current':(sales.currentPhase===null||p.phase<sales.currentPhase)?'sold_out':'upcoming'};
  });
  return {
    capacity: 1500,
    occupied: slotCounts.occupied || 0,
    held: slotCounts.held || 0,
    available: slotCounts.available || 0,
    retired: slotCounts.retired || 0,
    published: publishedRows?.total || 0,
    sectorsRepresented: sectors?.total || 0,
    currentPhase: sales.currentPhase,
    currentPriceUsdCents: sales.priceUsdCents,
    salesMode: sales.mode,
    checkoutOpen: sales.checkoutOpen,
    phases: summaries,
  };
}
