/**
 * Canned responses and macros. A macro is a canned response with actions
 * (status, priority, tags, team, assign to me) applied after the reply is sent.
 * Actions run as the agent, so their permissions apply.
 */
import { z } from "zod";
import { actorUserId, assertCan, can, type Actor } from "@/core/rbac/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/core/errors";
import { db } from "../db";
import { audit, type AuditContext } from "../audit";
import { sanitizeRichText } from "../richtext";
import { assignTicket, getTicket, transitionTicket, updateTicket } from "./tickets";

export const macroActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_status"), value: z.string().max(60) }),
  z.object({ type: z.literal("set_priority"), value: z.string().max(60) }),
  z.object({ type: z.literal("add_tag"), value: z.string().max(40) }),
  z.object({ type: z.literal("assign_team"), teamId: z.string().max(64) }),
  z.object({ type: z.literal("assign_to_me") }),
]);

export const cannedSchema = z.object({
  name: z.string().trim().min(1).max(120),
  body: z.string().max(50_000),
  actions: z.array(macroActionSchema).max(10).default([]),
  isShared: z.boolean().default(true),
  teamId: z.string().max(64).nullable().optional(),
});

export async function listCanned(actor: Actor) {
  assertCan(actor, "ticket.reply");
  return db.cannedResponse.findMany({ where: { OR: [{ isShared: true }, { ownerId: actorUserId(actor) }] }, orderBy: { name: "asc" }, include: { owner: { select: { name: true } }, team: { select: { name: true } } } });
}

function assertCanEdit(actor: Actor, row: { isShared: boolean; ownerId: string | null }) {
  if (row.isShared ? !can(actor, "canned.manage") : row.ownerId !== actorUserId(actor)) throw new ForbiddenError("canned.manage");
}

export async function createCanned(actor: Actor, raw: z.input<typeof cannedSchema>, ctx?: AuditContext) {
  assertCan(actor, "ticket.reply");
  const input = cannedSchema.parse(raw);
  if (input.isShared) assertCan(actor, "canned.manage");
  const row = await db.cannedResponse.create({ data: { ...input, body: sanitizeRichText(input.body), actions: input.actions, ownerId: actorUserId(actor) } });
  await audit(actor, { action: "canned.create", entityType: "canned_response", entityId: row.id, changes: { name: input.name, shared: input.isShared } }, ctx);
  return { id: row.id };
}

export async function updateCanned(actor: Actor, id: string, raw: Partial<z.input<typeof cannedSchema>>, ctx?: AuditContext) {
  const row = await db.cannedResponse.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("Canned response");
  assertCanEdit(actor, row);
  const input = cannedSchema.partial().parse(raw);
  if (input.isShared && !row.isShared) assertCan(actor, "canned.manage");
  await db.cannedResponse.update({ where: { id }, data: { ...input, ...(input.body !== undefined ? { body: sanitizeRichText(input.body) } : {}), ...(input.actions ? { actions: input.actions } : {}) } });
  await audit(actor, { action: "canned.update", entityType: "canned_response", entityId: id }, ctx);
  return { id };
}

export async function deleteCanned(actor: Actor, id: string, ctx?: AuditContext) {
  const row = await db.cannedResponse.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("Canned response");
  assertCanEdit(actor, row);
  await db.cannedResponse.delete({ where: { id } });
  await audit(actor, { action: "canned.delete", entityType: "canned_response", entityId: id }, ctx);
  return { id };
}

/** Apply a macro's actions to a ticket (the reply itself is posted by the caller). */
export async function applyMacro(actor: Actor, ticketId: string, cannedId: string, ctx?: AuditContext) {
  const row = await db.cannedResponse.findUnique({ where: { id: cannedId } });
  if (!row || (!row.isShared && row.ownerId !== actorUserId(actor))) throw new NotFoundError("Canned response");
  const actions = z.array(macroActionSchema).parse(row.actions ?? []);
  const ticket = await getTicket(actor, ticketId);
  const results: string[] = [];
  for (const a of actions) {
    if (a.type === "set_status") {
      if (ticket.status !== a.value) await transitionTicket(actor, ticket.id, { to: a.value }, { ctx });
    } else if (a.type === "set_priority") await updateTicket(actor, ticket.id, { priority: a.value }, { ctx });
    else if (a.type === "add_tag") await updateTicket(actor, ticket.id, { tags: [...new Set([...(await getTicket(actor, ticket.id)).tags.map((t) => t.tag.name), a.value.toLowerCase()])] }, { ctx });
    else if (a.type === "assign_team") await assignTicket(actor, ticket.id, { teamId: a.teamId }, { ctx });
    else if (a.type === "assign_to_me") {
      const uid = actorUserId(actor);
      if (!uid) throw new ValidationError("No user to assign to");
      await assignTicket(actor, ticket.id, { assigneeId: uid }, { ctx });
    }
    results.push(a.type);
  }
  return { applied: results };
}
