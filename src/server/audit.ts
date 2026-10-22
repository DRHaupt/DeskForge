/**
 * Audit log writer. Every mutating API route records an entry through the API
 * wrapper; domain services can also record explicit entries with a diff.
 */
import type { Actor } from "@/core/rbac/actor";
import { actorLabel } from "@/core/rbac/actor";
import { ActorType } from "@/generated/prisma/enums";
import type { DbOrTx } from "./db";
import { db as defaultDb } from "./db";
import { logger } from "./logger";

export type AuditContext = { ip?: string | null; userAgent?: string | null; requestId?: string | null };

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: unknown;
};

function actorFields(actor: Actor) {
  if (actor.kind === "user") return { actorType: ActorType.USER, actorId: actor.id };
  if (actor.kind === "api_key") return { actorType: ActorType.API_KEY, actorId: actor.userId };
  return { actorType: ActorType.SYSTEM, actorId: null };
}

export async function audit(actor: Actor, entry: AuditEntry, ctx: AuditContext = {}, client: DbOrTx = defaultDb): Promise<void> {
  try {
    await client.auditLog.create({
      data: {
        ...actorFields(actor),
        actorLabel: actorLabel(actor),
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        changes: entry.changes === undefined ? undefined : (JSON.parse(JSON.stringify(entry.changes)) as object),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, 500) ?? null,
        requestId: ctx.requestId ?? null,
      },
    });
  } catch (err) {
    // Never fail the user's action because the audit write failed, but make it loud.
    logger.error({ err, entry }, "failed to write audit log");
  }
}

/** Shallow diff of two records, ignoring timestamps and secrets. */
export function diff(before: Record<string, unknown> | null, after: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const ignore = new Set(["updatedAt", "createdAt", "passwordHash", "totpSecret", "searchVector"]);
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (ignore.has(key)) continue;
    const from = before?.[key];
    const to = after[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) out[key] = { from, to };
  }
  return out;
}
