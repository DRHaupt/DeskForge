/** Saved ticket views (personal or shared). */
import { z } from "zod";
import { actorUserId, assertCan, can, type Actor } from "@/core/rbac/actor";
import { ForbiddenError, NotFoundError } from "@/core/errors";
import { db } from "../db";
import { ticketFilterSchema } from "./tickets";

export const viewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  isShared: z.boolean().default(false),
  teamId: z.string().max(64).nullable().optional(),
  /** Query-string style filters, validated with the ticket filter schema. */
  filters: z.record(z.string(), z.string().max(2000)).refine((f) => ticketFilterSchema.safeParse(f).success, { message: "invalid filters" }),
  columns: z.array(z.string().max(40)).max(20).optional(),
});

export async function listViews(actor: Actor) {
  const uid = actorUserId(actor);
  return db.savedView.findMany({ where: { OR: [{ ownerId: uid }, { isShared: true }] }, orderBy: [{ isShared: "asc" }, { order: "asc" }, { name: "asc" }] });
}

export async function createView(actor: Actor, input: z.infer<typeof viewSchema>) {
  assertCan(actor, "ticket.view_own");
  if (input.isShared) assertCan(actor, "view.share");
  return db.savedView.create({ data: { name: input.name, isShared: input.isShared, teamId: input.teamId ?? null, filters: input.filters, columns: input.columns, ownerId: actorUserId(actor) } });
}

async function ownedView(actor: Actor, id: string) {
  const v = await db.savedView.findUnique({ where: { id } });
  if (!v) throw new NotFoundError("View");
  const mine = v.ownerId === actorUserId(actor);
  if (!mine && !(v.isShared && can(actor, "view.share"))) throw new ForbiddenError("view.share");
  return v;
}

export async function updateView(actor: Actor, id: string, input: Partial<z.infer<typeof viewSchema>>) {
  await ownedView(actor, id);
  if (input.isShared) assertCan(actor, "view.share");
  return db.savedView.update({ where: { id }, data: { ...input, filters: input.filters ?? undefined } });
}

export async function deleteView(actor: Actor, id: string) {
  await ownedView(actor, id);
  await db.savedView.delete({ where: { id } });
  return { id };
}
