/**
 * API keys: "dfk_<8 char prefix>_<secret>". Only a SHA-256 hash is stored.
 * A key's effective permissions are its own scopes intersected with the
 * creating user's current permissions, so a key can never exceed its owner.
 */
import type { ApiKeyActor } from "@/core/rbac/actor";
import { expandPermissions } from "@/core/rbac/roles";
import type { Permission } from "@/core/rbac/permissions";
import { randomToken, sha256 } from "./crypto";
import { db } from "./db";
import { loadUserActor } from "./actor";

export function generateApiKey(): { key: string; prefix: string; hashedKey: string } {
  const prefix = randomToken(6).replace(/[-_]/g, "x").slice(0, 8);
  const key = `dfk_${prefix}_${randomToken(32)}`;
  return { key, prefix, hashedKey: sha256(key) };
}

export async function authenticateApiKey(key: string): Promise<ApiKeyActor | null> {
  if (!key.startsWith("dfk_") || key.length > 200) return null;
  const row = await db.apiKey.findUnique({ where: { hashedKey: sha256(key) } });
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt < new Date())) return null;
  let permissions = expandPermissions(row.permissions);
  let teamIds: string[] = [];
  let roles: string[] = [];
  if (row.createdById) {
    const owner = await loadUserActor(db, row.createdById);
    if (!owner) return null; // owner deactivated → key stops working
    permissions = new Set([...permissions].filter((p) => owner.permissions.has(p))) as Set<Permission>;
    teamIds = owner.teamIds;
    roles = owner.roles;
  }
  // Touch lastUsedAt at most once a minute.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  return { kind: "api_key", id: row.id, name: row.name, userId: row.createdById, roles, permissions, teamIds };
}
