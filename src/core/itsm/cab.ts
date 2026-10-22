/**
 * Change advisory board (CAB) rules, kept pure so they can be unit tested.
 *
 * A change type's workflow is read generically: the first state in the
 * "pending" category is where changes wait for the CAB. From there, the first
 * transition into an "open" state is approval, and the first into a "closed"
 * state is rejection. No state keys are hard-coded.
 */
import type { BusinessConfig, TicketTypeConfig } from "../config/schema";

export type CabStates = { awaiting: string; approved: string; rejected: string | null };

export function cabStates(type: TicketTypeConfig): CabStates | null {
  if (type.feature !== "changeManagement") return null;
  const states = type.workflow.states;
  const awaiting = states.find((s) => s.category === "pending");
  if (!awaiting) return null;
  const targets = type.workflow.transitions.filter((t) => t.from.includes(awaiting.key) || t.from.includes("*")).map((t) => states.find((s) => s.key === t.to)!).filter(Boolean);
  const approved = targets.find((s) => s.category === "open");
  if (!approved) return null;
  const rejected = targets.find((s) => s.category === "closed") ?? null;
  return { awaiting: awaiting.key, approved: approved.key, rejected: rejected?.key ?? null };
}

export function cabRequired(cfg: BusinessConfig, riskLevel: string | null | undefined): boolean {
  // Unknown risk is treated as needing review.
  if (!riskLevel) return true;
  return cfg.itsm.cabRequiredForRisk.includes(riskLevel);
}

export type Vote = "PENDING" | "APPROVED" | "REJECTED" | "NOT_REQUIRED";

/** One rejection rejects; otherwise approved once `quorum` (capped at the number of voters) approve. */
export function cabOutcome(votes: Vote[], quorum: number): "APPROVED" | "REJECTED" | "PENDING" {
  const live = votes.filter((v) => v !== "NOT_REQUIRED");
  if (live.includes("REJECTED")) return "REJECTED";
  const needed = Math.max(1, Math.min(quorum, live.length));
  return live.filter((v) => v === "APPROVED").length >= needed ? "APPROVED" : "PENDING";
}
