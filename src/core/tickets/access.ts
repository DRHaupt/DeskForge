/**
 * Ticket visibility rules. Mirrored as a Prisma `where` in src/server/services/tickets.ts —
 * keep both in sync (tests cover both).
 */
import { can, type Actor } from "../rbac/actor";

export type TicketAccessFacts = {
  requesterId: string;
  organizationId: string | null;
  teamId: string | null;
  assigneeId: string | null;
  watcherUserIds?: string[];
};

function userId(actor: Actor): string | null {
  if (actor.kind === "user") return actor.id;
  if (actor.kind === "api_key") return actor.userId;
  return null;
}

export function canViewTicket(actor: Actor, t: TicketAccessFacts): boolean {
  if (actor.kind === "system") return true;
  if (can(actor, "ticket.view_all")) return true;
  const uid = userId(actor);
  if (can(actor, "ticket.view_team")) {
    // Agents see their teams' queues, untriaged tickets (no team) and anything assigned to them.
    if (t.teamId === null || actor.teamIds.includes(t.teamId) || t.assigneeId === uid) return true;
  }
  if (uid && (t.requesterId === uid || t.watcherUserIds?.includes(uid))) return can(actor, "ticket.view_own");
  if (actor.kind === "user" && actor.organizationId && t.organizationId === actor.organizationId) {
    return can(actor, "ticket.view_org") || actor.orgTicketAccess;
  }
  return false;
}

/** Agents (and auditors) see internal notes; requesters never do. */
export function canSeeInternal(actor: Actor): boolean {
  return actor.kind === "system" || can(actor, "ticket.comment_internal") || can(actor, "ticket.view_all") || can(actor, "ticket.view_team");
}

/** Whether the actor works the ticket as staff (vs. the customer side). */
export function isStaffFor(actor: Actor, t: TicketAccessFacts): boolean {
  return canSeeInternal(actor) && canViewTicket(actor, t);
}
