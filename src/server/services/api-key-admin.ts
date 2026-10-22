/** API key management. Keys are shown once at creation; only a hash is stored. */
import { z } from "zod";
import { actorUserId, assertCan, ForbiddenError, type Actor } from "@/core/rbac/actor";
import { ALL_PERMISSIONS, WILDCARD } from "@/core/rbac/permissions";
import { expandPermissions } from "@/core/rbac/roles";
import { NotFoundError } from "@/core/errors";
import { audit, type AuditContext } from "../audit";
import { generateApiKey } from "../api-keys";
import { db } from "../db";

export const apiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  permissions: z.array(z.string()).min(1).max(ALL_PERMISSIONS.length + 1),
  expiresAt: z.iso.datetime().nullable().optional(),
});

export async function listApiKeys(actor: Actor) {
  assertCan(actor, "apikey.manage");
  return db.apiKey.findMany({
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    select: { id: true, name: true, prefix: true, permissions: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true, createdBy: { select: { name: true } } },
  });
}

export async function createApiKey(actor: Actor, input: z.infer<typeof apiKeySchema>, ctx?: AuditContext) {
  assertCan(actor, "apikey.manage");
  const perms = input.permissions.includes(WILDCARD) ? [WILDCARD] : [...new Set(input.permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p)))];
  // A key can't be given more than its creator holds (and is re-capped at use time).
  if (actor.kind !== "system") for (const p of expandPermissions(perms)) if (!actor.permissions.has(p)) throw new ForbiddenError(p, `You can't grant "${p}" to an API key`);
  const { key, prefix, hashedKey } = generateApiKey();
  const row = await db.apiKey.create({ data: { name: input.name, prefix, hashedKey, permissions: perms, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, createdById: actorUserId(actor) } });
  await audit(actor, { action: "apikey.create", entityType: "api_key", entityId: row.id, changes: { name: input.name, permissions: perms } }, ctx);
  return { id: row.id, key, prefix };
}

export async function revokeApiKey(actor: Actor, id: string, ctx?: AuditContext) {
  assertCan(actor, "apikey.manage");
  const row = await db.apiKey.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("API key");
  await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(actor, { action: "apikey.revoke", entityType: "api_key", entityId: id, changes: { name: row.name } }, ctx);
  return { id };
}
