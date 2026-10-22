/** Prisma `where` equivalent of core/tickets/access.ts#canViewTicket. Keep the two in sync. */
import { can, actorUserId, type Actor } from "@/core/rbac/actor";
import type { Prisma } from "@/generated/prisma/client";

export function ticketVisibilityWhere(actor: Actor): Prisma.TicketWhereInput {
  if (actor.kind === "system" || can(actor, "ticket.view_all")) return {};
  const uid = actorUserId(actor);
  const or: Prisma.TicketWhereInput[] = [];
  if (can(actor, "ticket.view_team")) {
    or.push({ teamId: null }, { teamId: { in: actor.teamIds } });
    if (uid) or.push({ assigneeId: uid });
  }
  if (uid && can(actor, "ticket.view_own")) {
    or.push({ requesterId: uid }, { watchers: { some: { userId: uid } } });
  }
  if (actor.kind === "user" && actor.organizationId && (can(actor, "ticket.view_org") || actor.orgTicketAccess)) {
    or.push({ organizationId: actor.organizationId });
  }
  return or.length ? { OR: or } : { id: "__no_access__" };
}
