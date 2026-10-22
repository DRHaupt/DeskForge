/**
 * Admin services: users, roles, teams, organizations.
 *
 * Every function takes the acting Actor and enforces permissions itself, so
 * the rules hold for the UI, the REST API and scripts alike.
 */
import { z } from "zod";
import { getConfig } from "@/core/config/loader";
import { checkPassword } from "@/core/auth/password";
import { actorUserId, assertCan, can, type Actor } from "@/core/rbac/actor";
import { ALL_PERMISSIONS, WILDCARD } from "@/core/rbac/permissions";
import { expandPermissions } from "@/core/rbac/roles";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/core/errors";
import { AssignmentStrategy } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { audit, diff, type AuditContext } from "../audit";
import { db } from "../db";
import { hashPassword } from "../passwords";
import { normalizeEmail, organizationForEmail } from "../users";
import { applyConfigTeamMembers } from "../config-sync";

// ─── Schemas (shared with route handlers) ──────────────────────────────────

const keyField = z.string().regex(/^[a-z][a-z0-9_-]{1,40}$/, "lowercase letters, digits, - and _");

export const createUserSchema = z.object({
  email: z.email().max(320),
  name: z.string().trim().min(1).max(120),
  password: z.string().max(256).optional(),
  roleKeys: z.array(z.string()).min(1).max(10),
  organizationId: z.string().nullable().optional(),
  orgTicketAccess: z.boolean().optional(),
  jobTitle: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
});

export const updateUserSchema = z.object({
  email: z.email().max(320).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  password: z.string().max(256).optional(),
  roleKeys: z.array(z.string()).min(1).max(10).optional(),
  organizationId: z.string().nullable().optional(),
  orgTicketAccess: z.boolean().optional(),
  isActive: z.boolean().optional(),
  jobTitle: z.string().max(120).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  /** Clears a TOTP enrolment (e.g. lost phone). */
  resetTwoFactor: z.literal(true).optional(),
  unlock: z.literal(true).optional(),
});

export const roleSchema = z.object({
  key: keyField,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  permissions: z.array(z.string()).max(ALL_PERMISSIONS.length + 1),
});

export const updateRoleSchema = roleSchema.omit({ key: true }).partial();

export const teamSchema = z.object({
  key: keyField,
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).nullable().optional(),
  email: z.email().nullable().optional(),
  assignmentStrategy: z.enum(AssignmentStrategy).default(AssignmentStrategy.MANUAL),
  escalationTeamId: z.string().nullable().optional(),
  escalationUserId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const updateTeamSchema = teamSchema.omit({ key: true }).partial();

export const teamMembersSchema = z.object({
  members: z
    .array(z.object({ userId: z.string(), isLead: z.boolean().default(false), isAvailable: z.boolean().default(true) }))
    .max(500),
});

export const organizationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: keyField,
  domains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "must be a domain like example.com")).max(20).default([]),
  phone: z.string().max(40).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});
export const updateOrganizationSchema = organizationSchema.partial();

// ─── Guards ────────────────────────────────────────────────────────────────

/** A role's permissions must be within the actor's own, so nobody can grant more than they have. */
async function assertCanGrantRoles(actor: Actor, roleKeys: string[]) {
  const roles = await db.role.findMany({ where: { key: { in: roleKeys } } });
  if (roles.length !== new Set(roleKeys).size) throw new ValidationError("Unknown role", { roleKeys: "one or more roles do not exist" });
  if (actor.kind === "system") return roles;
  for (const role of roles) {
    for (const p of expandPermissions(role.permissions)) {
      if (!actor.permissions.has(p)) throw new ForbiddenError(p, `You cannot grant the "${role.name}" role because it includes permissions you don't have.`);
    }
  }
  return roles;
}

async function adminCount(excludingUserId?: string): Promise<number> {
  return db.user.count({
    where: { isActive: true, id: excludingUserId ? { not: excludingUserId } : undefined, roles: { some: { role: { permissions: { has: WILDCARD } } } } },
  });
}

function validatePassword(password: string) {
  const problems = checkPassword(password, getConfig().auth.local.passwordPolicy);
  if (problems.length) throw new ValidationError(`Password ${problems.join(", ")}`, { password: problems.join(", ") });
}

// ─── Users ─────────────────────────────────────────────────────────────────

export type UserListFilter = { q?: string; role?: string; organizationId?: string; active?: boolean; page: number; pageSize: number };

export async function listUsers(actor: Actor, f: UserListFilter) {
  assertCan(actor, "user.view");
  const where: Prisma.UserWhereInput = {
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { email: { contains: f.q, mode: "insensitive" } }] } : {}),
    ...(f.role ? { roles: { some: { role: { key: f.role } } } } : {}),
    ...(f.organizationId ? { organizationId: f.organizationId } : {}),
    ...(f.active !== undefined ? { isActive: f.active } : {}),
  };
  const [total, items] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        lastLoginAt: true,
        totpEnabled: true,
        organization: { select: { id: true, name: true } },
        roles: { select: { role: { select: { key: true, name: true } } } },
        teamMemberships: { select: { team: { select: { id: true, name: true } } } },
      },
    }),
  ]);
  return { total, page: f.page, pageSize: f.pageSize, items };
}

export async function getUser(actor: Actor, id: string) {
  assertCan(actor, "user.view");
  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      isActive: true,
      jobTitle: true,
      phone: true,
      organizationId: true,
      orgTicketAccess: true,
      lastLoginAt: true,
      lockedUntil: true,
      totpEnabled: true,
      passwordHash: true,
      createdAt: true,
      identities: { select: { provider: true, createdAt: true } },
      roles: { select: { role: { select: { id: true, key: true, name: true } } } },
      teamMemberships: { select: { isLead: true, team: { select: { id: true, name: true } } } },
    },
  });
  if (!user) throw new NotFoundError("User");
  const { passwordHash, ...rest } = user;
  return { ...rest, hasPassword: Boolean(passwordHash) };
}

export async function createUser(actor: Actor, input: z.infer<typeof createUserSchema>, ctx: AuditContext = {}) {
  assertCan(actor, "user.manage");
  const roles = await assertCanGrantRoles(actor, input.roleKeys);
  const email = normalizeEmail(input.email);
  if (await db.user.findUnique({ where: { email } })) throw new ConflictError("A user with that email already exists");
  if (input.password) validatePassword(input.password);
  const cfg = getConfig();
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        name: input.name,
        jobTitle: input.jobTitle,
        phone: input.phone,
        passwordHash: input.password ? await hashPassword(input.password) : null,
        passwordChangedAt: input.password ? new Date() : null,
        organizationId: input.organizationId !== undefined ? input.organizationId : await organizationForEmail(tx, email),
        orgTicketAccess: input.orgTicketAccess ?? cfg.portal.requestersSeeOrgTickets,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
    });
    await applyConfigTeamMembers(tx, cfg, email);
    return created;
  });
  await audit(actor, { action: "user.create", entityType: "user", entityId: user.id, changes: { email, roles: input.roleKeys } }, ctx);
  return { id: user.id };
}

export async function updateUser(actor: Actor, id: string, input: z.infer<typeof updateUserSchema>, ctx: AuditContext = {}) {
  assertCan(actor, "user.manage");
  const before = await db.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
  if (!before) throw new NotFoundError("User");
  const self = actorUserId(actor) === id;

  // You may not edit someone who has permissions you lack (e.g. a non-admin editing an admin).
  if (actor.kind !== "system") {
    for (const p of expandPermissions(before.roles.flatMap((r) => r.role.permissions))) {
      if (!actor.permissions.has(p)) throw new ForbiddenError(p, "You cannot edit a user who has permissions you don't have.");
    }
  }

  const data: Prisma.UserUpdateInput = {};
  let bumpSession = false;
  if (input.name !== undefined) data.name = input.name;
  if (input.jobTitle !== undefined) data.jobTitle = input.jobTitle;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.orgTicketAccess !== undefined) data.orgTicketAccess = input.orgTicketAccess;
  if (input.organizationId !== undefined) data.organization = input.organizationId ? { connect: { id: input.organizationId } } : { disconnect: true };
  if (input.email !== undefined) {
    const email = normalizeEmail(input.email);
    if (email !== before.email && (await db.user.findUnique({ where: { email } }))) throw new ConflictError("A user with that email already exists");
    data.email = email;
  }
  if (input.password) {
    validatePassword(input.password);
    data.passwordHash = await hashPassword(input.password);
    data.passwordChangedAt = new Date();
    bumpSession = !self;
  }
  if (input.unlock) {
    data.lockedUntil = null;
    data.failedLoginCount = 0;
  }
  if (input.resetTwoFactor) {
    data.totpEnabled = false;
    data.totpSecret = null;
    bumpSession = true;
  }
  if (input.isActive !== undefined && input.isActive !== before.isActive) {
    if (!input.isActive && self) throw new ValidationError("You cannot deactivate your own account");
    const wasAdmin = before.roles.some((r) => r.role.permissions.includes(WILDCARD));
    if (!input.isActive && wasAdmin && (await adminCount(id)) === 0) throw new ValidationError("Cannot deactivate the last admin");
    data.isActive = input.isActive;
    bumpSession = true;
  }

  await db.$transaction(async (tx) => {
    if (input.roleKeys) {
      const roles = await assertCanGrantRoles(actor, input.roleKeys);
      const losesAdmin = before.roles.some((r) => r.role.permissions.includes(WILDCARD)) && !roles.some((r) => r.permissions.includes(WILDCARD));
      if (losesAdmin && (await adminCount(id)) === 0) throw new ValidationError("Cannot remove the admin role from the last admin");
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id })) });
    }
    if (bumpSession) data.sessionVersion = { increment: 1 };
    await tx.user.update({ where: { id }, data });
  });

  const after = await db.user.findUniqueOrThrow({ where: { id } });
  const changes = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
  if (input.roleKeys) changes.roles = { from: before.roles.map((r) => r.role.key), to: input.roleKeys };
  if (input.password) changes.password = { from: "•••", to: "changed" };
  delete changes.sessionVersion;
  await audit(actor, { action: "user.update", entityType: "user", entityId: id, changes }, ctx);
  return { id };
}

// ─── Roles ─────────────────────────────────────────────────────────────────

export async function listRoles(actor: Actor) {
  if (!can(actor, "role.manage") && !can(actor, "user.view")) throw new ForbiddenError("role.manage");
  return db.role.findMany({ orderBy: [{ isSystem: "desc" }, { name: "asc" }], include: { _count: { select: { users: true } } } });
}

function cleanPermissions(perms: string[]): string[] {
  if (perms.includes(WILDCARD)) return [WILDCARD];
  return [...new Set(perms.filter((p) => (ALL_PERMISSIONS as string[]).includes(p)))].sort();
}

function assertWithinOwn(actor: Actor, perms: string[]) {
  if (actor.kind === "system") return;
  for (const p of expandPermissions(perms)) {
    if (!actor.permissions.has(p)) throw new ForbiddenError(p, `You cannot grant "${p}" because you don't have it.`);
  }
}

export async function createRole(actor: Actor, input: z.infer<typeof roleSchema>, ctx: AuditContext = {}) {
  assertCan(actor, "role.manage");
  const permissions = cleanPermissions(input.permissions);
  assertWithinOwn(actor, permissions);
  if (await db.role.findUnique({ where: { key: input.key } })) throw new ConflictError("A role with that key already exists");
  const role = await db.role.create({ data: { key: input.key, name: input.name, description: input.description, permissions } });
  await audit(actor, { action: "role.create", entityType: "role", entityId: role.id, changes: { key: role.key, permissions } }, ctx);
  return { id: role.id };
}

export async function updateRole(actor: Actor, id: string, input: z.infer<typeof updateRoleSchema>, ctx: AuditContext = {}) {
  assertCan(actor, "role.manage");
  const before = await db.role.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Role");
  const data: Prisma.RoleUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.permissions !== undefined) {
    const permissions = cleanPermissions(input.permissions);
    assertWithinOwn(actor, [...permissions, ...before.permissions]);
    if (before.permissions.includes(WILDCARD) && !permissions.includes(WILDCARD)) {
      const others = await db.user.count({
        where: { isActive: true, roles: { some: { role: { permissions: { has: WILDCARD }, id: { not: id } } } } },
      });
      if (others === 0) throw new ValidationError("This would leave no one with full admin access");
    }
    data.permissions = permissions;
  }
  const after = await db.role.update({ where: { id }, data });
  await audit(actor, { action: "role.update", entityType: "role", entityId: id, changes: diff(before as never, after as never) }, ctx);
  return { id };
}

export async function deleteRole(actor: Actor, id: string, ctx: AuditContext = {}) {
  assertCan(actor, "role.manage");
  const role = await db.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!role) throw new NotFoundError("Role");
  if (role.isSystem) throw new ValidationError("Built-in roles cannot be deleted");
  if (role._count.users > 0) throw new ConflictError(`Role is assigned to ${role._count.users} user(s); reassign them first`);
  await db.role.delete({ where: { id } });
  await audit(actor, { action: "role.delete", entityType: "role", entityId: id, changes: { key: role.key } }, ctx);
  return { id };
}

// ─── Teams ─────────────────────────────────────────────────────────────────

export async function listTeams(actor: Actor) {
  if (!can(actor, "team.manage") && !can(actor, "ticket.view_team")) throw new ForbiddenError("team.manage");
  return db.team.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: {
      _count: { select: { members: true } },
      escalationTeam: { select: { id: true, name: true } },
      escalationUser: { select: { id: true, name: true } },
    },
  });
}

export async function getTeam(actor: Actor, id: string) {
  if (!can(actor, "team.manage") && !can(actor, "ticket.view_team")) throw new ForbiddenError("team.manage");
  const team = await db.team.findUnique({
    where: { id },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true, isActive: true } } }, orderBy: { user: { name: "asc" } } },
      escalationTeam: { select: { id: true, name: true } },
      escalationUser: { select: { id: true, name: true } },
    },
  });
  if (!team) throw new NotFoundError("Team");
  return team;
}

export async function createTeam(actor: Actor, input: z.infer<typeof teamSchema>, ctx: AuditContext = {}) {
  assertCan(actor, "team.manage");
  if (await db.team.findUnique({ where: { key: input.key } })) throw new ConflictError("A team with that key already exists");
  const team = await db.team.create({ data: input });
  await audit(actor, { action: "team.create", entityType: "team", entityId: team.id, changes: input }, ctx);
  return { id: team.id };
}

export async function updateTeam(actor: Actor, id: string, input: z.infer<typeof updateTeamSchema>, ctx: AuditContext = {}) {
  assertCan(actor, "team.manage");
  const before = await db.team.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Team");
  if (input.escalationTeamId === id) throw new ValidationError("A team cannot escalate to itself");
  const after = await db.team.update({ where: { id }, data: input });
  await audit(actor, { action: "team.update", entityType: "team", entityId: id, changes: diff(before as never, after as never) }, ctx);
  return { id };
}

export async function setTeamMembers(actor: Actor, id: string, input: z.infer<typeof teamMembersSchema>, ctx: AuditContext = {}) {
  assertCan(actor, "team.manage");
  const team = await db.team.findUnique({ where: { id }, include: { members: true } });
  if (!team) throw new NotFoundError("Team");
  const ids = input.members.map((m) => m.userId);
  if (new Set(ids).size !== ids.length) throw new ValidationError("Duplicate members");
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (users.length !== ids.length) throw new ValidationError("Unknown user in members list");
  await db.$transaction(async (tx) => {
    await tx.teamMember.deleteMany({ where: { teamId: id, userId: { notIn: ids } } });
    for (const m of input.members) {
      await tx.teamMember.upsert({
        where: { teamId_userId: { teamId: id, userId: m.userId } },
        create: { teamId: id, userId: m.userId, isLead: m.isLead, isAvailable: m.isAvailable },
        update: { isLead: m.isLead, isAvailable: m.isAvailable },
      });
    }
  });
  const before = team.members.map((m) => m.userId).sort();
  await audit(actor, { action: "team.members", entityType: "team", entityId: id, changes: { members: { from: before, to: [...ids].sort() } } }, ctx);
  return { id };
}

export async function deleteTeam(actor: Actor, id: string, ctx: AuditContext = {}) {
  assertCan(actor, "team.manage");
  const team = await db.team.findUnique({ where: { id }, include: { _count: { select: { tickets: true } } } });
  if (!team) throw new NotFoundError("Team");
  if (team._count.tickets > 0) {
    // Keep history intact: deactivate instead of deleting.
    await db.team.update({ where: { id }, data: { isActive: false } });
    await audit(actor, { action: "team.deactivate", entityType: "team", entityId: id }, ctx);
    return { id, deactivated: true };
  }
  await db.team.delete({ where: { id } });
  await audit(actor, { action: "team.delete", entityType: "team", entityId: id, changes: { key: team.key } }, ctx);
  return { id, deleted: true };
}

// ─── Organizations ─────────────────────────────────────────────────────────

export async function listOrganizations(actor: Actor, q?: string) {
  assertCan(actor, "org.view");
  return db.organization.findMany({
    where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
    orderBy: { name: "asc" },
    include: { _count: { select: { users: true, tickets: true } } },
  });
}

export async function createOrganization(actor: Actor, input: z.infer<typeof organizationSchema>, ctx: AuditContext = {}) {
  assertCan(actor, "org.manage");
  if (await db.organization.findUnique({ where: { slug: input.slug } })) throw new ConflictError("An organization with that slug already exists");
  const org = await db.organization.create({ data: input });
  await audit(actor, { action: "organization.create", entityType: "organization", entityId: org.id, changes: input }, ctx);
  return { id: org.id };
}

export async function updateOrganization(actor: Actor, id: string, input: z.infer<typeof updateOrganizationSchema>, ctx: AuditContext = {}) {
  assertCan(actor, "org.manage");
  const before = await db.organization.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Organization");
  const after = await db.organization.update({ where: { id }, data: input });
  await audit(actor, { action: "organization.update", entityType: "organization", entityId: id, changes: diff(before as never, after as never) }, ctx);
  return { id };
}

// ─── Audit log ─────────────────────────────────────────────────────────────

export async function listAuditLogs(actor: Actor, f: { entityType?: string; entityId?: string; actorId?: string; action?: string; page: number; pageSize: number }) {
  assertCan(actor, "audit.view");
  const where: Prisma.AuditLogWhereInput = {
    entityType: f.entityType,
    entityId: f.entityId,
    actorId: f.actorId,
    action: f.action ? { startsWith: f.action } : undefined,
  };
  const [total, items] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
  ]);
  return { total, page: f.page, pageSize: f.pageSize, items };
}
