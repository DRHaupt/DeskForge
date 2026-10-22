/**
 * Workflow engine: which status changes are allowed, for whom.
 *
 * A transition is allowed when the ticket's current state is in `from` (or
 * `from` is "*"), and the actor holds one of the transition's `roles`
 * ("*" = anyone allowed to change status at all). The system actor
 * (automations, SLA escalations) may perform any configured transition.
 */
import type { TicketTypeConfig, WorkflowState, WorkflowTransition } from "../config/schema";

export type WorkflowActor =
  | { kind: "system" }
  | {
      kind: "user";
      roles: string[];
      /** Holds ticket.transition (agents) — required for "*" transitions. */
      canTransition: boolean;
      /** Full-access admins may perform any configured transition. */
      isSuperuser?: boolean;
      /** Whether this actor is the ticket's requester (gates the "requester" role). */
      isRequester: boolean;
    };

export type AvailableTransition = { to: string; name: string; requireComment: boolean; category: WorkflowState["category"] };

export class WorkflowError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

export function stateOf(type: TicketTypeConfig, key: string): WorkflowState | undefined {
  return type.workflow.states.find((s) => s.key === key);
}

function roleMatches(t: WorkflowTransition, actor: WorkflowActor): boolean {
  if (actor.kind === "system") return true;
  if (actor.isSuperuser) return true;
  for (const role of t.roles) {
    if (role === "*") {
      if (actor.canTransition) return true;
      continue;
    }
    if (role === "requester") {
      // The requester role only applies to the person who raised this ticket.
      if (actor.roles.includes("requester") && actor.isRequester) return true;
      continue;
    }
    if (actor.roles.includes(role)) return true;
  }
  return false;
}

function fromMatches(t: WorkflowTransition, from: string): boolean {
  return t.from.includes("*") || t.from.includes(from);
}

/** Transitions the actor may perform from `from`, one entry per target state. */
export function availableTransitions(type: TicketTypeConfig, from: string, actor: WorkflowActor): AvailableTransition[] {
  const seen = new Set<string>();
  const out: AvailableTransition[] = [];
  for (const t of type.workflow.transitions) {
    if (t.to === from || seen.has(t.to)) continue;
    if (!fromMatches(t, from) || !roleMatches(t, actor)) continue;
    const target = stateOf(type, t.to);
    if (!target) continue;
    seen.add(t.to);
    out.push({ to: t.to, name: t.name ?? target.name, requireComment: t.requireComment, category: target.category });
  }
  return out;
}

/** Validate a transition; returns the matching rule or throws WorkflowError. */
export function resolveTransition(type: TicketTypeConfig, from: string, to: string, actor: WorkflowActor, comment?: string | null): AvailableTransition {
  if (!stateOf(type, to)) throw new WorkflowError(`"${to}" is not a status of ${type.name}`);
  if (from === to) throw new WorkflowError(`Ticket is already ${stateOf(type, to)!.name}`);
  const anyRule = type.workflow.transitions.some((t) => t.to === to && fromMatches(t, from));
  if (!anyRule) {
    throw new WorkflowError(`${type.name} tickets can't move from ${stateOf(type, from)?.name ?? from} to ${stateOf(type, to)!.name}`);
  }
  const allowed = availableTransitions(type, from, actor).find((t) => t.to === to);
  if (!allowed) throw new WorkflowError(`You are not allowed to move this ticket to ${stateOf(type, to)!.name}`);
  if (allowed.requireComment && !comment?.trim()) throw new WorkflowError(`A comment is required to move this ticket to ${stateOf(type, to)!.name}`);
  return allowed;
}

/** Categories that count as "done" for SLAs, queues and the portal. */
export function isDoneCategory(category: WorkflowState["category"]): boolean {
  return category === "resolved" || category === "closed";
}
