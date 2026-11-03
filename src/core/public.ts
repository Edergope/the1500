// Minimal read-only implementation for local bootstrap.
// Claude owns core APIs, auth, transactions and publish pipeline from Sprint 1 onward.
export interface PublicStats {
  capacity: number;
  occupied: number;
  held: number;
  available: number;
  published: number;
  sectorsRepresented: number;
  currentPhase: number | null;
}

export async function getPublicStats(db: D1Database): Promise<PublicStats> {
  const [slotCounts, publishedRows, sectors] = await Promise.all([
    db.prepare(`SELECT
      SUM(CASE WHEN status IN ('assigned','retired') THEN 1 ELSE 0 END) occupied,
      SUM(CASE WHEN status='held' THEN 1 ELSE 0 END) held,
      SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) available,
      MIN(CASE WHEN status IN ('available','held') THEN phase ELSE NULL END) current_phase,
      COUNT(*) capacity
    FROM slots`).first<{
      occupied: number; held: number; available: number; current_phase: number | null; capacity: number;
    }>(),
    db.prepare("SELECT COUNT(*) total FROM companies WHERE publication_status='published'").first<{ total: number }>(),
    db.prepare("SELECT COUNT(DISTINCT industry) total FROM companies WHERE publication_status='published' AND industry IS NOT NULL").first<{ total: number }>(),
  ]);
  if (!slotCounts || slotCounts.capacity !== 1500) throw new Error('Inventory integrity check failed');
  return {
    capacity: slotCounts.capacity,
    occupied: slotCounts.occupied || 0,
    held: slotCounts.held || 0,
    available: slotCounts.available || 0,
    published: publishedRows?.total || 0,
    sectorsRepresented: sectors?.total || 0,
    currentPhase: slotCounts.current_phase,
  };
}
