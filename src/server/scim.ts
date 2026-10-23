/**
 * SCIM 2.0 user provisioning: lets an identity provider (Microsoft Entra) create,
 * update and deactivate DeskForge accounts automatically.
 *
 * Rules:
 * - A single bearer token, stored as a SHA-256 hash, shown once when generated.
 * - New users get `scim.defaultRole`. Roles are never changed by provisioning
 *   afterwards; promote people in the admin UI.
 * - An existing account with the same email is adopted (linked) rather than
 *   duplicated, unless it's already linked to a different directory user.
 * - "Delete" and `active: false` deactivate and sign the person out; history
 *   (tickets, comments) is kept.
 */
import { timingSafeEqual } from "node:crypto";
import { getConfig } from "@/core/config/loader";
import { assertCan, systemActor, type Actor } from "@/core/rbac/actor";
import { WILDCARD } from "@/core/rbac/permissions";
import {
  changesFromPatch,
  changesFromResource,
  displayNameFrom,
  LIST_SCHEMA,
  parseFilter,
  ScimError,
  USER_SCHEMA,
  type UserChanges,
} from "@/core/scim/scim";
import type { Prisma } from "@/generated/prisma/client";
import { audit, type AuditContext } from "./audit";
import { randomToken, sha256 } from "./crypto";
import { db } from "./db";
import { logger } from "./logger";
import { appUrl } from "./mail/templates";
import { sendWelcomeEmail } from "./services/onboarding";
import { normalizeEmail, provisionUser } from "./users";

const TOKEN_KEY = "scim.token";
export const SCIM_ACTOR = systemActor("scim");

// ─── Token ─────────────────────────────────────────────────────────────────

type TokenSetting = { hash: string; createdAt: string; createdBy: string | null };

export async function scimTokenInfo(): Promise<{ createdAt: string; createdBy: string | null } | null> {
  const row = await db.systemSetting.findUnique({ where: { key: TOKEN_KEY } });
  if (!row) return null;
  const v = row.value as TokenSetting;
  return { createdAt: v.createdAt, createdBy: v.createdBy };
}

/** Create (or replace) the provisioning token. Returns the plain token, shown once. */
export async function rotateScimToken(createdBy: string | null): Promise<string> {
  const token = `dfscim_${randomToken(32)}`;
  const value: TokenSetting = { hash: sha256(token), createdAt: new Date().toISOString(), createdBy };
  await db.systemSetting.upsert({ where: { key: TOKEN_KEY }, create: { key: TOKEN_KEY, value }, update: { value } });
  return token;
}

export async function revokeScimToken(): Promise<void> {
  await db.systemSetting.deleteMany({ where: { key: TOKEN_KEY } });
}

export async function verifyScimToken(authorization: string | null): Promise<boolean> {
  const m = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const row = await db.systemSetting.findUnique({ where: { key: TOKEN_KEY } });
  if (!row) return false;
  const expected = Buffer.from((row.value as TokenSetting).hash, "hex");
  const given = Buffer.from(sha256(m[1]!.trim()), "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ─── Resources ─────────────────────────────────────────────────────────────

const userSelect = {
  id: true,
  email: true,
  name: true,
  isActive: true,
  jobTitle: true,
  phone: true,
  scimExternalId: true,
  scimUserName: true,
  provisionedVia: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

type ScimUserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

export function toScimUser(u: ScimUserRow) {
  const [givenName, ...rest] = u.name.split(" ");
  return {
    schemas: [USER_SCHEMA],
    id: u.id,
    ...(u.scimExternalId ? { externalId: u.scimExternalId } : {}),
    userName: u.scimUserName ?? u.email,
    name: { formatted: u.name, givenName: givenName ?? u.name, ...(rest.length ? { familyName: rest.join(" ") } : {}) },
    displayName: u.name,
    emails: [{ value: u.email, type: "work", primary: true }],
    active: u.isActive,
    ...(u.jobTitle ? { title: u.jobTitle } : {}),
    ...(u.phone ? { phoneNumbers: [{ value: u.phone, type: "work" }] } : {}),
    meta: { resourceType: "User", created: u.createdAt.toISOString(), lastModified: u.updatedAt.toISOString(), location: appUrl(`/scim/v2/Users/${u.id}`) },
  };
}

function listResponse(resources: unknown[], total: number, startIndex: number) {
  return { schemas: [LIST_SCHEMA], totalResults: total, startIndex, itemsPerPage: resources.length, Resources: resources };
}

const ci = (value: string) => ({ equals: value, mode: "insensitive" as const });

export async function listScimUsers(params: { filter?: string | null; startIndex?: number; count?: number }) {
  const f = parseFilter(params.filter);
  const startIndex = Math.max(1, Math.floor(params.startIndex ?? 1) || 1);
  const count = Math.min(200, Math.max(0, Math.floor(params.count ?? 100) || 0));
  let where: Prisma.UserWhereInput = {};
  if (f?.attr === "userName") where = { OR: [{ scimUserName: ci(f.value) }, { scimUserName: null, email: ci(f.value) }] };
  else if (f?.attr === "externalId") where = { scimExternalId: f.value };
  else if (f?.attr === "id") where = { id: f.value };
  else if (f?.attr === "email") where = { email: ci(f.value) };
  const [total, rows] = await Promise.all([
    db.user.count({ where }),
    count === 0 ? Promise.resolve([]) : db.user.findMany({ where, select: userSelect, orderBy: { createdAt: "asc" }, skip: startIndex - 1, take: count }),
  ]);
  return listResponse(rows.map(toScimUser), total, startIndex);
}

export async function getScimUser(id: string) {
  const u = await db.user.findUnique({ where: { id }, select: userSelect });
  if (!u) throw new ScimError(404, `User ${id} not found`);
  return toScimUser(u);
}

/** Is this user the last active admin? Provisioning never locks everyone out. */
async function isLastAdmin(userId: string): Promise<boolean> {
  const adminRole = { some: { role: { permissions: { has: WILDCARD } } } };
  const isAdmin = await db.user.count({ where: { id: userId, roles: adminRole } });
  if (!isAdmin) return false;
  const others = await db.user.count({ where: { id: { not: userId }, isActive: true, roles: adminRole } });
  return others === 0;
}

function emailFrom(c: UserChanges): string | null {
  const candidate = c.email ?? (c.userName?.includes("@") ? c.userName : null);
  if (!candidate) return null;
  const email = normalizeEmail(candidate);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Turn SCIM changes into a user update, checking email uniqueness. */
async function updateData(userId: string, c: UserChanges, current: ScimUserRow): Promise<Prisma.UserUpdateInput> {
  const data: Prisma.UserUpdateInput = { provisionedVia: "scim" };
  if (c.userName !== undefined) data.scimUserName = c.userName;
  if (c.externalId !== undefined) data.scimExternalId = c.externalId;
  if (c.title !== undefined) data.jobTitle = c.title;
  if (c.phone !== undefined) data.phone = c.phone;
  const nameTouched = [c.displayName, c.formatted, c.givenName, c.familyName].some((v) => v !== undefined);
  if (nameTouched) {
    const name = displayNameFrom(c, "");
    if (name) data.name = name.slice(0, 200);
  }
  if (c.email !== undefined || c.userName !== undefined) {
    const email = emailFrom(c);
    if (email && email !== current.email) {
      const taken = await db.user.findFirst({ where: { email, id: { not: userId } }, select: { id: true } });
      if (taken) throw new ScimError(409, `Another account already uses ${email}`, "uniqueness");
      data.email = email;
    }
  }
  if (c.active !== undefined && c.active !== current.isActive) {
    if (!c.active && (await isLastAdmin(userId))) {
      logger.warn({ userId }, "SCIM tried to deactivate the last admin; ignored");
    } else {
      data.isActive = c.active;
      if (!c.active) data.sessionVersion = { increment: 1 };
    }
  }
  return data;
}

async function applyUpdate(id: string, c: UserChanges, action: string, ctx?: AuditContext) {
  const current = await db.user.findUnique({ where: { id }, select: userSelect });
  if (!current) throw new ScimError(404, `User ${id} not found`);
  const data = await updateData(id, c, current);
  const updated = await db.user.update({ where: { id }, data, select: userSelect });
  const changes: Record<string, unknown> = {};
  for (const k of ["email", "name", "isActive", "jobTitle", "phone", "scimUserName", "scimExternalId"] as const) {
    if (current[k] !== updated[k]) changes[k] = { from: current[k], to: updated[k] };
  }
  if (Object.keys(changes).length) {
    const verb = changes.isActive ? (updated.isActive ? "scim.user_reactivated" : "scim.user_deactivated") : action;
    await audit(SCIM_ACTOR, { action: verb, entityType: "user", entityId: id, changes }, ctx);
  }
  return toScimUser(updated);
}

export async function createScimUser(body: Record<string, unknown>, ctx?: AuditContext) {
  const cfg = getConfig();
  const c = changesFromResource(body);
  const email = emailFrom(c);
  if (!email) throw new ScimError(400, "An email address is required (emails or an email-shaped userName)", "invalidValue");

  const existing = await db.user.findFirst({
    where: { OR: [{ email }, ...(c.externalId ? [{ scimExternalId: c.externalId }] : []), { scimUserName: ci(c.userName!) }] },
    select: userSelect,
  });
  if (existing) {
    const linkedElsewhere = existing.scimExternalId && c.externalId && existing.scimExternalId !== c.externalId;
    if (linkedElsewhere || existing.provisionedVia === "scim") throw new ScimError(409, `User ${c.userName} already exists`, "uniqueness");
    // A person who already had an account (added by hand or signed in with SSO): link it.
    return applyUpdate(existing.id, c, "scim.user_linked", ctx);
  }

  const role = await db.role.findUnique({ where: { key: cfg.scim.defaultRole }, select: { permissions: true } });
  if (!role) throw new ScimError(500, `scim.defaultRole "${cfg.scim.defaultRole}" isn't a role in DeskForge`);
  if (role.permissions.includes(WILDCARD)) throw new ScimError(500, `scim.defaultRole "${cfg.scim.defaultRole}" has full admin rights; provisioning can't grant that`);

  const created = await provisionUser({ email, name: displayNameFrom(c, email).slice(0, 200), roleKeys: [cfg.scim.defaultRole] });
  const user = await db.user.update({
    where: { id: created.id },
    data: {
      provisionedVia: "scim",
      scimUserName: c.userName,
      scimExternalId: c.externalId ?? null,
      jobTitle: c.title ?? null,
      phone: c.phone ?? null,
      isActive: c.active ?? true,
    },
    select: userSelect,
  });
  await audit(SCIM_ACTOR, { action: "scim.user_created", entityType: "user", entityId: user.id, changes: { email, role: cfg.scim.defaultRole } }, ctx);
  if (cfg.scim.sendWelcomeEmail && user.isActive) {
    try {
      await sendWelcomeEmail(SCIM_ACTOR, user.id, ctx);
    } catch (err) {
      logger.warn({ err, userId: user.id }, "could not send welcome email to provisioned user");
    }
  }
  return toScimUser(user);
}

export async function replaceScimUser(id: string, body: Record<string, unknown>, ctx?: AuditContext) {
  return applyUpdate(id, changesFromResource(body), "scim.user_updated", ctx);
}

export async function patchScimUser(id: string, body: Record<string, unknown>, ctx?: AuditContext) {
  return applyUpdate(id, changesFromPatch(body), "scim.user_updated", ctx);
}

/** SCIM DELETE: deactivate (keeping history) rather than erase. */
export async function deleteScimUser(id: string, ctx?: AuditContext) {
  await applyUpdate(id, { active: false }, "scim.user_deactivated", ctx);
}

// ─── Discovery ─────────────────────────────────────────────────────────────

export function serviceProviderConfig() {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: appUrl("/admin/provisioning"),
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "Token from Administration → Provisioning", primary: true }],
    meta: { resourceType: "ServiceProviderConfig", location: appUrl("/scim/v2/ServiceProviderConfig") },
  };
}

// ─── Admin ─────────────────────────────────────────────────────────────────

/** What the Administration → Provisioning page shows. */
export async function provisioningOverview(actor: Actor) {
  assertCan(actor, "user.manage");
  const [token, provisioned, active, recent] = await Promise.all([
    scimTokenInfo(),
    db.user.count({ where: { provisionedVia: "scim" } }),
    db.user.count({ where: { provisionedVia: "scim", isActive: true } }),
    db.auditLog.findMany({ where: { action: { startsWith: "scim." } }, orderBy: { createdAt: "desc" }, take: 25 }),
  ]);
  const ids = [...new Set(recent.map((r) => r.entityId).filter((x): x is string => Boolean(x)))];
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return {
    enabled: getConfig().scim.enabled,
    defaultRole: getConfig().scim.defaultRole,
    sendWelcomeEmail: getConfig().scim.sendWelcomeEmail,
    tenantUrl: appUrl("/scim/v2"),
    token,
    counts: { provisioned, active },
    recent: recent.map((r) => ({ id: r.id, action: r.action, createdAt: r.createdAt, user: r.entityId ? (byId.get(r.entityId) ?? null) : null })),
  };
}

export async function generateScimToken(actor: Actor, ctx?: AuditContext): Promise<{ token: string }> {
  assertCan(actor, "user.manage");
  const replacing = Boolean(await scimTokenInfo());
  const token = await rotateScimToken(actor.kind === "user" ? actor.name : null);
  await audit(actor, { action: replacing ? "scim.token_rotated" : "scim.token_created", entityType: "system_setting", entityId: TOKEN_KEY }, ctx);
  return { token };
}

export async function removeScimToken(actor: Actor, ctx?: AuditContext): Promise<void> {
  assertCan(actor, "user.manage");
  await revokeScimToken();
  await audit(actor, { action: "scim.token_revoked", entityType: "system_setting", entityId: TOKEN_KEY }, ctx);
}
