/**
 * Problem management: incidents link to a problem with CAUSED_BY
 * (incident → problem). Problems record a root cause and workaround; a
 * problem flagged as a known error shows its workaround to agents on every
 * linked incident and in the known-error list. When a problem is resolved,
 * open linked incidents get an internal note so their owners can follow up.
 */
import { z } from "zod";
import { getConfig } from "@/core/config/loader";
import { ValidationError } from "@/core/errors";
import { assertCan, type Actor } from "@/core/rbac/actor";
import { CommentSource, CommentVisibility, RelationshipType, StatusCategory } from "@/generated/prisma/enums";
import type { AuditContext } from "../audit";
import { db } from "../db";
import { onTicketEvent } from "../events";
import { logger } from "../logger";
import { escapeHtml } from "../mail/templates";
import { richText } from "../richtext";
import { ticketVisibilityWhere } from "./ticket-access";

export function problemType() {
  const cfg = getConfig();
  return cfg.features.problemManagement ? cfg.ticketTypes.find((t) => t.feature === "problemManagement") : undefined;
}

export const knownErrorFilter = z.object({ q: z.string().trim().max(200).optional(), includeResolved: z.coerce.boolean().default(false) });

export async function listKnownErrors(actor: Actor, f: z.infer<typeof knownErrorFilter>) {
  assertCan(actor, "ticket.comment_internal");
  const type = problemType();
  if (!type) return [];
  const rows = await db.ticket.findMany({
    where: {
      AND: [
        ticketVisibilityWhere(actor),
        { deletedAt: null, knownError: true, type: { key: type.key } },
        f.includeResolved ? {} : { statusCategory: { notIn: [StatusCategory.RESOLVED, StatusCategory.CLOSED] } },
        f.q
          ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { number: { contains: f.q, mode: "insensitive" } }, { workaround: { contains: f.q, mode: "insensitive" } }, { rootCause: { contains: f.q, mode: "insensitive" } }] }
          : {},
      ],
    },
    select: {
      id: true, number: true, title: true, status: true, statusCategory: true, priority: true, rootCause: true, workaround: true, updatedAt: true,
      team: { select: { name: true } },
      assignee: { select: { name: true } },
      _count: { select: { incomingLinks: { where: { type: RelationshipType.CAUSED_BY } } } },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return rows.map(({ _count, ...r }) => ({ ...r, incidentCount: _count.incomingLinks }));
}

export const raiseProblemSchema = z.object({ title: z.string().trim().min(3).max(200).optional(), description: z.string().max(200_000).optional() });

/** Create a problem from an incident and link the incident to it. */
export async function raiseProblem(actor: Actor, ticketId: string, input: z.infer<typeof raiseProblemSchema>, ctx?: AuditContext) {
  assertCan(actor, "problem.manage");
  const type = problemType();
  if (!type) throw new ValidationError("Problem management is turned off");
  const { createTicket, getTicket, linkTicket } = await import("./tickets");
  const incident = await getTicket(actor, ticketId);
  if (incident.type.key === type.key) throw new ValidationError("This ticket is already a problem");
  // Required custom fields get their first option / blank default so agents can fill them in after.
  const { fillRequiredFields } = await import("@/core/tickets/fields");
  const problem = await createTicket(
    actor,
    {
      type: type.key,
      title: input.title ?? incident.title,
      description: input.description ?? `<p>Raised from ${escapeHtml(incident.number)}.</p>${incident.description}`,
      requesterId: actor.kind === "user" ? actor.id : incident.requesterId,
      fields: fillRequiredFields(type.fields, {}),
    },
    { ctx },
  );
  await linkTicket(actor, incident.id, { type: RelationshipType.CAUSED_BY, target: problem.number }, ctx);
  return problem;
}

async function noteOnIncidents(problemId: string, html: string) {
  const links = await db.relationship.findMany({
    where: { type: RelationshipType.CAUSED_BY, targetTicketId: problemId, sourceTicket: { deletedAt: null, statusCategory: { notIn: [StatusCategory.RESOLVED, StatusCategory.CLOSED] } } },
    select: { sourceTicketId: true },
  });
  const note = richText(html);
  for (const l of links) {
    await db.comment.create({ data: { ticketId: l.sourceTicketId, body: note.html, bodyText: note.text, visibility: CommentVisibility.INTERNAL, source: CommentSource.SYSTEM, isSystem: true } });
  }
  return links.length;
}

onTicketEvent(async (event) => {
  if (event.type !== "ticket.status_changed" && event.type !== "ticket.updated") return;
  const type = problemType();
  if (!type) return;
  try {
    const t = await db.ticket.findUnique({ where: { id: event.ticketId }, select: { id: true, number: true, title: true, workaround: true, rootCause: true, statusCategory: true, type: { select: { key: true } } } });
    if (!t || t.type.key !== type.key) return;
    const cat = event.changes?.statusCategory as { from: string; to: string } | undefined;
    if (event.type === "ticket.status_changed" && cat && cat.to === StatusCategory.RESOLVED && cat.from !== StatusCategory.RESOLVED) {
      await noteOnIncidents(t.id, `<p>Problem ${escapeHtml(t.number)} (${escapeHtml(t.title)}) has been resolved.${t.rootCause ? ` Root cause: ${escapeHtml(t.rootCause)}` : ""}</p><p>Check whether this incident can be resolved too.</p>`);
    }
    const ke = event.changes?.knownError as { from: unknown; to: unknown } | undefined;
    if (event.type === "ticket.updated" && ke && ke.to === true) {
      await noteOnIncidents(t.id, `<p>Problem ${escapeHtml(t.number)} is now a known error.${t.workaround ? ` Workaround: ${escapeHtml(t.workaround)}` : ""}</p>`);
    }
  } catch (err) {
    logger.error({ err, ticketId: event.ticketId }, "problem hook failed");
  }
});

/** Known-error workarounds for problems this ticket is linked to (shown on incidents). */
export async function workaroundsFor(ticketId: string) {
  const rows = await db.relationship.findMany({
    where: { type: RelationshipType.CAUSED_BY, sourceTicketId: ticketId, targetTicket: { deletedAt: null } },
    select: { targetTicket: { select: { id: true, number: true, title: true, status: true, knownError: true, workaround: true } } },
  });
  return rows.map((r) => r.targetTicket!).filter((t) => t.knownError && t.workaround);
}

