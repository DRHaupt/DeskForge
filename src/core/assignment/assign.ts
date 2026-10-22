/**
 * Automatic assignment strategies for a team's queue.
 *
 * - round_robin:   next available member after the one picked last time
 * - load_balanced: available member with the fewest open tickets
 *                  (ties broken round-robin so work still spreads evenly)
 * - manual:        nobody; the ticket waits in the team queue
 */
export type Strategy = "ROUND_ROBIN" | "LOAD_BALANCED" | "MANUAL";

export type Candidate = {
  userId: string;
  /** Team member marked available (not on leave). */
  available: boolean;
  /** User account active. */
  active: boolean;
  /** Open (not resolved/closed) tickets currently assigned. */
  openCount: number;
};

/** Candidates in stable order (e.g. by name). Returns null when no one can take the ticket. */
export function pickAssignee(strategy: Strategy, candidates: Candidate[], lastAssignedUserId: string | null): string | null {
  if (strategy === "MANUAL") return null;
  const eligible = candidates.filter((c) => c.available && c.active);
  if (eligible.length === 0) return null;

  // Rotate so the member after the last pick comes first.
  const lastIdx = lastAssignedUserId ? eligible.findIndex((c) => c.userId === lastAssignedUserId) : -1;
  const rotated = lastIdx === -1 ? eligible : [...eligible.slice(lastIdx + 1), ...eligible.slice(0, lastIdx + 1)];

  if (strategy === "ROUND_ROBIN") return rotated[0]!.userId;

  const min = Math.min(...rotated.map((c) => c.openCount));
  return rotated.find((c) => c.openCount === min)!.userId;
}
