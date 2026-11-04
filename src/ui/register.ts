import type { PhaseSummary } from '../lib/contracts/inventory';

/** Decision 2026-11-03: positions below this one are reserved for founders, by invitation. */
export const FIRST_PAID_POSITION = 101;

/** One character per position in the map from getPositionMap: published, other assigned, retired, or open. */
export type PositionKind = 'p' | 'o' | 'x' | 'a';

export const phaseOf = (position: number, phases: PhaseSummary[]) =>
  phases.find((p) => position >= p.firstPosition && position <= p.lastPosition);

export interface PositionCounts {
  published: number;
  taken: number;
  retired: number;
  reserved: number;
  forSale: number;
  later: number;
}

export function countPositions(map: string, phases: PhaseSummary[]): PositionCounts {
  const counts: PositionCounts = { published: 0, taken: 0, retired: 0, reserved: 0, forSale: 0, later: 0 };
  for (let i = 0; i < map.length; i++) {
    const n = i + 1;
    const code = map[i];
    if (code === 'p') counts.published++;
    else if (code === 'o') counts.taken++;
    else if (code === 'x') counts.retired++;
    else if (n < FIRST_PAID_POSITION) counts.reserved++;
    else if (phaseOf(n, phases)?.status === 'current' && phaseOf(n, phases)?.phase !== 4) counts.forSale++;
    else counts.later++;
  }
  return counts;
}

/** Per phase: positions no longer open, reserved for founders, and still for sale or to open. */
export function phaseBreakdown(map: string, phase: PhaseSummary) {
  let gone = 0;
  let reserved = 0;
  let open = 0;
  for (let n = phase.firstPosition; n <= phase.lastPosition; n++) {
    if (map[n - 1] !== 'a') gone++;
    else if (n < FIRST_PAID_POSITION) reserved++;
    else open++;
  }
  return { gone, reserved, open, total: phase.lastPosition - phase.firstPosition + 1 };
}
