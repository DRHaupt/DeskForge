/** Agile board helpers (pure). Columns come from `boards` in the business config. */
import type { BusinessConfig } from "../config/schema";

export type BoardConfig = BusinessConfig["boards"][number];

export function columnIndexForStatus(board: BoardConfig, status: string): number {
  return board.columns.findIndex((c) => c.states.includes(status));
}

/** Rank for a card dropped between `prev` (above) and `next` (below). */
export function rankBetween(prev: number | null | undefined, next: number | null | undefined): number {
  const STEP = 1024;
  if (prev != null && next != null) return (prev + next) / 2;
  if (prev != null) return prev + STEP;
  if (next != null) return next - STEP;
  return 0;
}

/** True when ranks have got too close to split again (float precision); caller should renumber. */
export function needsRebalance(prev: number | null | undefined, next: number | null | undefined): boolean {
  return prev != null && next != null && Math.abs(next - prev) < 1e-6;
}
