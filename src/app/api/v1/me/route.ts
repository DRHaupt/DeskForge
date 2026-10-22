import { z } from "zod";
import { apiRoute, HttpError } from "@/server/api";
import { db } from "@/server/db";

export const GET = apiRoute({ authOnly: true }, async ({ actor }) => {
  if (actor.kind !== "user") throw new HttpError(400, "Not a user session");
  const u = await db.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { id: true, email: true, name: true, phone: true, jobTitle: true, timezone: true, notifyByEmail: true, totpEnabled: true, organization: { select: { id: true, name: true } } },
  });
  return { ...u, roles: actor.roles, permissions: [...actor.permissions] };
});

export const PATCH = apiRoute(
  {
    authOnly: true,
    auditAction: "user.profile",
    status: 200,
    body: z.object({ name: z.string().trim().min(1).max(120).optional(), phone: z.string().max(40).nullable().optional(), jobTitle: z.string().max(120).nullable().optional(), notifyByEmail: z.boolean().optional() }),
  },
  async ({ actor, body }) => {
    if (actor.kind !== "user") throw new HttpError(400, "Not a user session");
    await db.user.update({ where: { id: actor.id }, data: body });
    return { ok: true };
  },
);
