/**
 * Ticket service: the single entry point for every ticket change, used by the
 * agent console, the portal, the REST API, email intake and automations.
 * Every function takes an Actor and enforces permissions and workflow rules.
 */
import { z } from "zod";
import { getConfig } from "@/core/config/loader";
import { activeTicketTypes, getTicketTypeConfig, priorityFromMatrix } from "@/core/config/helpers";
import type { BusinessConfig, FieldConfig, TicketTypeConfig } from "@/core/config/schema";
import { actorUserId, assertCan, can, canAny, ForbiddenError, isAgent, type Actor } from "@/core/rbac/actor";
import { WILDCARD } from "@/core/rbac/permissions";
import { NotFoundError, ValidationError, ConflictError } from "@/core/errors";
import { pickAssignee, type Candidate } from "@/core/assignment/assign";
import { canSeeInternal, canViewTicket } from "@/core/tickets/access";
import { buildFieldValuesSchema, fromStorage, toStorage } from "@/core/tickets/fields";
import { formatTicketNumber } from "@/core/tickets/numbering";
import { extractMentionIds } from "@/core/text/mentions";
import { availableTransitions, resolveTransition, stateOf, type WorkflowActor } from "@/core/workflow/engine";
import { Prisma } from "@/generated/prisma/client";
import { CommentSource, CommentVisibility, RelationshipType, StatusCategory, TicketSource } from "@/generated/prisma/enums";
import { audit, type AuditContext } from "../audit";
import { db, type Tx } from "../db";
import { emitTicketEvent } from "../events";
import { plainTextToHtml, richText } from "../richtext";
import { normalizeEmail, provisionUser } from "../users";
import { ticketVisibilityWhere } from "./ticket-access";
import "../hooks";

// ─── Helpers ───────────────────────────────────────────────────────────────

export const CATEGORY_MAP: Record<string, StatusCategory> = {
  new: StatusCategory.NEW,
  open: StatusCategory.OPEN,
  pending: StatusCategory.PENDING,
  resolved: StatusCategory.RESOLVED,
  closed: StatusCategory.CLOSED,
};

const OPEN_CATEGORIES: StatusCategory[] = [StatusCategory.NEW, StatusCategory.OPEN, StatusCategory.PENDING];

/** Problem and change tickets need their module permission to create, edit or move. */
function assertModulePermission(actor: Actor, typeCfg: TicketTypeConfig) {
  if (typeCfg.feature === "problemManagement") assertCan(actor, "problem.manage");
  if (typeCfg.feature === "changeManagement") assertCan(actor, "change.manage");
}

function typeConfigOrThrow(cfg: BusinessConfig, key: string): TicketTypeConfig {
  const t = getTicketTypeConfig(cfg, key);
  if (!t) throw new ValidationError(`Ticket type "${key}" is not configured`);
  return t;
}

function isSuperuser(actor: Actor): boolean {
  return actor.kind !== "system" && actor.permissions.size > 0 && can(actor, "config.edit") && can(actor, "role.manage");
}

export function workflowActorFor(actor: Actor, ticket: { requesterId: string }): WorkflowActor {
  if (actor.kind === "system") return { kind: "system" };
  return {
    kind: "user",
    roles: actor.roles,
    canTransition: can(actor, "ticket.transition"),
    isSuperuser: isSuperuser(actor),
    isRequester: actorUserId(actor) === ticket.requesterId,
  };
}

async function upsertTags(tx: Tx, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of names) {
    const name = raw.trim().toLowerCase().slice(0, 40);
    if (!name) continue;
    const tag = await tx.tag.upsert({ where: { name }, create: { name }, update: {} });
    ids.push(tag.id);
  }
  return [...new Set(ids)];
}

function assertKnown(list: { key: string }[], key: string | null | undefined, what: string) {
  if (key && !list.some((l) => l.key === key)) throw new ValidationError(`Unknown ${what} "${key}"`, { [what]: "unknown value" });
}

async function writeFieldValues(tx: Tx, ticketId: string, typeId: string, fields: FieldConfig[], values: Record<string, unknown>) {
  if (!Object.keys(values).length) return;
  const defs = await tx.ticketFieldDef.findMany({ where: { ticketTypeId: typeId, key: { in: Object.keys(values) } } });
  for (const def of defs) {
    const f = fields.find((x) => x.key === def.key);
    if (!f) continue;
    const v = values[def.key];
    if (v === null || v === undefined) {
      await tx.ticketFieldValue.deleteMany({ where: { ticketId, fieldDefId: def.id } });
      continue;
    }
    const storage = toStorage(f, v);
    const data = { ...storage, valueJson: storage.valueJson === null ? Prisma.DbNull : (storage.valueJson as Prisma.InputJsonValue) };
    await tx.ticketFieldValue.upsert({
      where: { ticketId_fieldDefId: { ticketId, fieldDefId: def.id } },
      create: { ticketId, fieldDefId: def.id, ...data },
      update: data,
    });
  }
}

async function validateUserIds(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  const found = await tx.user.count({ where: { id: { in: ids }, isActive: true } });
  if (found !== new Set(ids).size) throw new ValidationError("Unknown or inactive user");
}

/** Users who can work tickets (have a queue permission through any role). */
export function agentUserWhere(): Prisma.UserWhereInput {
  return {
    isActive: true,
    roles: { some: { role: { OR: [{ permissions: { has: "ticket.view_team" } }, { permissions: { has: "ticket.view_all" } }, { permissions: { has: WILDCARD } }] } } },
  };
}

// ─── Assignment ────────────────────────────────────────────────────────────

/** Pick an assignee for a team according to its strategy. Locks the team row for fair round-robin. */
export async function autoAssign(tx: Tx, teamId: string): Promise<string | null> {
  await tx.$executeRaw`SELECT id FROM teams WHERE id = ${teamId} FOR UPDATE`;
  const team = await tx.team.findUnique({
    where: { id: teamId },
    include: { members: { include: { user: { select: { id: true, name: true, isActive: true } } } } },
  });
  if (!team || !team.isActive || team.assignmentStrategy === "MANUAL") return null;
  const memberIds = team.members.map((m) => m.userId);
  const loads = await tx.ticket.groupBy({
    by: ["assigneeId"],
    where: { assigneeId: { in: memberIds }, statusCategory: { in: OPEN_CATEGORIES }, deletedAt: null },
    _count: { _all: true },
  });
  const loadBy = new Map(loads.map((l) => [l.assigneeId, l._count._all]));
  const candidates: Candidate[] = team.members
    .sort((a, b) => a.user.name.localeCompare(b.user.name))
    .map((m) => ({ userId: m.userId, available: m.isAvailable, active: m.user.isActive, openCount: loadBy.get(m.userId) ?? 0 }));
  const picked = pickAssignee(team.assignmentStrategy, candidates, team.lastAssignedUserId);
  if (picked) await tx.team.update({ where: { id: teamId }, data: { lastAssignedUserId: picked } });
  return picked;
}

// ─── Create ────────────────────────────────────────────────────────────────

export const createTicketSchema = z.object({
  type: z.string().min(1).max(60),
  title: z.string().trim().min(3, "Title is too short").max(200),
  description: z.string().max(200_000).default(""),
  descriptionFormat: z.enum(["html", "text"]).default("html"),
  requesterId: z.string().max(64).optional(),
  requesterEmail: z.email().max(320).optional(),
  requesterName: z.string().trim().max(120).optional(),
  teamId: z.string().max(64).nullable().optional(),
  assigneeId: z.string().max(64).nullable().optional(),
  categoryId: z.string().max(64).nullable().optional(),
  priority: z.string().max(60).optional(),
  impact: z.string().max(60).optional(),
  urgency: z.string().max(60).optional(),
  fields: z.record(z.string(), z.unknown()).default({}),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  watcherIds: z.array(z.string().max(64)).max(50).default([]),
  ccEmails: z.array(z.email()).max(20).default([]),
  attachmentIds: z.array(z.string().max(64)).max(20).default([]),
  /** Affected assets. Requesters may only pick assets assigned to them. */
  assetIds: z.array(z.string().max(64)).max(10).default([]),
  dueAt: z.iso.datetime().nullable().optional(),
});
export type CreateTicketInput = z.input<typeof createTicketSchema>;

export type CreateOptions = {
  source?: TicketSource;
  emailMessageId?: string | null;
  depth?: number;
  ctx?: AuditContext;
  /** Status to start in instead of the workflow's initial state (e.g. catalog approval). */
  initialStatus?: string;
};

export async function createTicket(actor: Actor, rawInput: CreateTicketInput, opts: CreateOptions = {}) {
  assertCan(actor, "ticket.create");
  const input = createTicketSchema.parse(rawInput);
  const cfg = getConfig();
  const staff = isAgent(actor) || actor.kind === "system";
  const uid = actorUserId(actor);

  const typeCfg = activeTicketTypes(cfg).find((t) => t.key === input.type);
  if (!typeCfg) throw new ValidationError(`Unknown ticket type "${input.type}"`, { type: "unknown" });
  if (!staff && !typeCfg.portalVisible) throw new ForbiddenError(undefined, `${typeCfg.name} tickets can't be created from the portal`);
  assertModulePermission(actor, typeCfg);

  // Staff-only inputs
  const staffOnly = { teamId: input.teamId, assigneeId: input.assigneeId, priority: input.priority, dueAt: input.dueAt };
  if (!staff && (Object.values(staffOnly).some((v) => v !== undefined && v !== null) || input.tags.length || input.watcherIds.length)) {
    throw new ForbiddenError(undefined, "Only agents can set team, assignee, priority, due date, tags or watchers");
  }

  assertKnown(cfg.priorities.levels, input.priority, "priority");
  assertKnown(cfg.priorities.impact, input.impact, "impact");
  assertKnown(cfg.priorities.urgency, input.urgency, "urgency");

  const fieldValues = buildFieldValuesSchema(typeCfg.fields, { mode: "create", audience: staff ? "agent" : "portal" }).parse(input.fields) as Record<string, unknown>;

  // Requester
  let requesterId = uid;
  if (input.requesterId || input.requesterEmail) {
    if (actor.kind !== "system") assertCan(actor, "ticket.create_on_behalf");
    if (input.requesterId) {
      const r = await db.user.findUnique({ where: { id: input.requesterId } });
      if (!r || !r.isActive) throw new ValidationError("Unknown requester", { requesterId: "unknown" });
      requesterId = r.id;
    } else {
      const email = normalizeEmail(input.requesterEmail!);
      const existing = await db.user.findUnique({ where: { email } });
      requesterId = existing?.id ?? (await provisionUser({ email, name: input.requesterName || email, roleKeys: ["requester"] })).id;
    }
  }
  if (!requesterId) throw new ValidationError("A requester is required");
  const requester = await db.user.findUniqueOrThrow({ where: { id: requesterId }, select: { id: true, organizationId: true } });

  // Routing
  const teamKey = typeCfg.defaultTeam;
  const teamId = input.teamId !== undefined ? input.teamId : teamKey ? ((await db.team.findUnique({ where: { key: teamKey } }))?.id ?? null) : null;
  if (input.assigneeId) await validateUserIds(db as unknown as Tx, [input.assigneeId]);
  if (input.categoryId && !(await db.category.findFirst({ where: { id: input.categoryId, isActive: true } }))) {
    throw new ValidationError("Unknown category", { categoryId: "unknown" });
  }

  // Asset-type custom fields link the asset too, with the same ownership rule.
  const fieldAssetIds = typeCfg.fields.filter((f) => f.type === "asset").map((f) => fieldValues[f.key]).filter((v): v is string => typeof v === "string" && v !== "");
  const assetIds = [...new Set([...input.assetIds, ...fieldAssetIds])];
  if (assetIds.length) {
    const ok = await db.asset.findMany({ where: { id: { in: assetIds }, deletedAt: null, ...(staff ? {} : { ownerId: requester.id }) }, select: { id: true } });
    if (ok.length !== assetIds.length) throw new ValidationError("Unknown asset", { assetIds: "unknown" });
  }

  const priority =
    input.priority ?? (input.impact && input.urgency ? priorityFromMatrix(cfg, input.impact, input.urgency) : (typeCfg.defaultPriority ?? cfg.priorities.default));
  const statusKey = opts.initialStatus ?? typeCfg.workflow.initial;
  const state = stateOf(typeCfg, statusKey);
  if (!state) throw new ValidationError(`Unknown initial status "${statusKey}"`);
  const description = input.descriptionFormat === "text" ? richText(plainTextToHtml(input.description)) : richText(input.description);

  const ticket = await db.$transaction(async (tx) => {
    const type = await tx.ticketType.findUniqueOrThrow({ where: { key: typeCfg.key } });
    const [row] = await tx.$queryRaw<{ n: number }[]>`
      UPDATE ticket_types SET next_number = next_number + 1, updated_at = now() WHERE id = ${type.id} RETURNING next_number - 1 AS n`;
    const number = formatTicketNumber(type.prefix, Number(row!.n), type.numberPadding);

    let assigneeId = input.assigneeId ?? null;
    if (!assigneeId && teamId && input.assigneeId === undefined) assigneeId = await autoAssign(tx, teamId);

    const tagIds = await upsertTags(tx, input.tags);
    if (input.watcherIds.length) await validateUserIds(tx, input.watcherIds);

    const created = await tx.ticket.create({
      data: {
        number,
        typeId: type.id,
        title: input.title,
        description: description.html,
        descriptionText: description.text,
        status: state.key,
        statusCategory: CATEGORY_MAP[state.category]!,
        priority,
        impact: input.impact,
        urgency: input.urgency,
        source: opts.source ?? (staff ? TicketSource.AGENT : TicketSource.PORTAL),
        requesterId: requester.id,
        organizationId: requester.organizationId,
        teamId,
        assigneeId,
        categoryId: input.categoryId ?? null,
        createdById: uid,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        emailMessageId: opts.emailMessageId ?? null,
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
        watchers: {
          create: [
            ...[...new Set(input.watcherIds)].filter((w) => w !== requester.id).map((userId) => ({ userId })),
            ...[...new Set(input.ccEmails.map(normalizeEmail))].map((email) => ({ email })),
          ],
        },
        statusHistory: { create: { toStatus: state.key, changedById: uid, reason: "created" } },
      },
    });
    await writeFieldValues(tx, created.id, type.id, typeCfg.fields, fieldValues);
    if (input.attachmentIds.length) {
      await tx.attachment.updateMany({
        where: { id: { in: input.attachmentIds }, ticketId: null, commentId: null, uploaderId: uid ?? undefined },
        data: { ticketId: created.id },
      });
    }
    if (assetIds.length) {
      await tx.relationship.createMany({ data: assetIds.map((targetAssetId) => ({ type: RelationshipType.AFFECTS_ASSET, sourceTicketId: created.id, targetAssetId, createdById: uid })) });
    }
    return created;
  });

  await audit(actor, { action: "ticket.create", entityType: "ticket", entityId: ticket.id, changes: { number: ticket.number, type: typeCfg.key } }, opts.ctx);
  await emitTicketEvent("ticket.created", ticket.id, actor, { depth: opts.depth });
  if (ticket.assigneeId) {
    await emitTicketEvent("ticket.assigned", ticket.id, actor, { changes: { assigneeId: { from: null, to: ticket.assigneeId } }, depth: opts.depth });
  }
  return { id: ticket.id, number: ticket.number };
}

// ─── Read ──────────────────────────────────────────────────────────────────

const detailInclude = {
  type: true,
  requester: { select: { id: true, name: true, email: true, phone: true, jobTitle: true, organizationId: true } },
  assignee: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true } },
  team: { select: { id: true, key: true, name: true } },
  organization: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, path: true } },
  fieldValues: { include: { fieldDef: true } },
  tags: { include: { tag: true } },
  watchers: { include: { user: { select: { id: true, name: true, email: true } } } },
  outgoingLinks: {
    include: {
      targetTicket: { select: { id: true, number: true, title: true, status: true, statusCategory: true, deletedAt: true } },
      targetAsset: { select: { id: true, tag: true, name: true } },
    },
  },
  incomingLinks: { include: { sourceTicket: { select: { id: true, number: true, title: true, status: true, statusCategory: true, deletedAt: true } } } },
  mergedInto: { select: { id: true, number: true } },
  slaInstances: { include: { policy: { select: { name: true } } } },
  attachments: { where: { commentId: null }, select: { id: true, filename: true, size: true, contentType: true, createdAt: true } },
  catalogRequest: { include: { item: { select: { name: true } }, approvals: { include: { approver: { select: { id: true, name: true } } } } } },
} satisfies Prisma.TicketInclude;

export type TicketDetail = Prisma.TicketGetPayload<{ include: typeof detailInclude }>;

/** Find by id or ticket number. Throws NotFound when missing *or not visible* (no existence leak). */
export async function getTicket(actor: Actor, idOrNumber: string): Promise<TicketDetail> {
  const where = /^[A-Z]{2,6}\d+$/.test(idOrNumber) ? { number: idOrNumber } : { id: idOrNumber };
  const ticket = await db.ticket.findFirst({ where: { ...where, deletedAt: null }, include: detailInclude });
  if (!ticket) throw new NotFoundError("Ticket");
  const visible = canViewTicket(actor, {
    requesterId: ticket.requesterId,
    organizationId: ticket.organizationId,
    teamId: ticket.teamId,
    assigneeId: ticket.assigneeId,
    watcherUserIds: ticket.watchers.flatMap((w) => (w.userId ? [w.userId] : [])),
  });
  if (!visible) throw new NotFoundError("Ticket");
  return ticket;
}

/** Custom field values keyed by field key, decoded to their JS types. */
export function ticketFieldValues(ticket: TicketDetail): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const fv of ticket.fieldValues) out[fv.fieldDef.key] = fromStorage({ type: fv.fieldDef.fieldType.toLowerCase() as FieldConfig["type"] }, fv);
  return out;
}

export type TimelineItem =
  | { kind: "comment"; id: string; at: Date; comment: Awaited<ReturnType<typeof loadComments>>[number] }
  | { kind: "status"; id: string; at: Date; from: string | null; to: string; by: string | null; reason: string | null }
  | { kind: "activity"; id: string; at: Date; action: string; by: string | null; changes: unknown };

async function loadComments(ticketId: string, includeInternal: boolean) {
  return db.comment.findMany({
    where: { ticketId, deletedAt: null, ...(includeInternal ? {} : { visibility: CommentVisibility.PUBLIC }) },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { id: true, name: true, email: true } },
      attachments: { select: { id: true, filename: true, size: true, contentType: true } },
    },
  });
}

/** Comments, status changes and (for staff) field-change activity, oldest first. */
export async function getTimeline(actor: Actor, ticket: TicketDetail): Promise<TimelineItem[]> {
  const internal = canSeeInternal(actor);
  const [comments, history, activity] = await Promise.all([
    loadComments(ticket.id, internal),
    db.statusHistory.findMany({ where: { ticketId: ticket.id }, orderBy: { createdAt: "asc" }, include: { changedBy: { select: { name: true } } } }),
    internal
      ? db.auditLog.findMany({
          where: { entityType: "ticket", entityId: ticket.id, action: { in: ["ticket.update", "ticket.assign", "ticket.link", "ticket.unlink", "ticket.merge", "ticket.watchers", "sla.override"] } },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
  ]);
  const items: TimelineItem[] = [
    ...comments.map((c) => ({ kind: "comment" as const, id: c.id, at: c.createdAt, comment: c })),
    ...history.map((h) => ({ kind: "status" as const, id: h.id, at: h.createdAt, from: h.fromStatus, to: h.toStatus, by: h.changedBy?.name ?? null, reason: h.reason })),
    ...activity.map((a) => ({ kind: "activity" as const, id: a.id, at: a.createdAt, action: a.action, by: a.actorLabel, changes: a.changes })),
  ];
  return items.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function transitionsFor(actor: Actor, ticket: { status: string; requesterId: string; type: { key: string } }) {
  const typeCfg = getTicketTypeConfig(getConfig(), ticket.type.key);
  if (!typeCfg) return [];
  if (actor.kind !== "system" && !can(actor, "ticket.transition") && actorUserId(actor) !== ticket.requesterId) return [];
  return availableTransitions(typeCfg, ticket.status, workflowActorFor(actor, ticket));
}

// ─── List ──────────────────────────────────────────────────────────────────

const csv = z
  .string()
  .max(2000)
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean));

export const ticketFilterSchema = z.object({
  q: z.string().max(200).optional(),
  status: csv.optional(),
  statusCategory: csv.pipe(z.array(z.enum(StatusCategory))).optional(),
  priority: csv.optional(),
  type: csv.optional(),
  teamId: csv.optional(),
  /** "me", "none", or a user id */
  assignee: z.string().max(64).optional(),
  requesterId: z.string().max(64).optional(),
  organizationId: z.string().max(64).optional(),
  categoryId: z.string().max(64).optional(),
  tag: z.string().max(40).optional(),
  open: z.enum(["true", "false"]).optional(),
  watching: z.enum(["true"]).optional(),
  createdFrom: z.iso.date().optional(),
  createdTo: z.iso.date().optional(),
  sort: z.enum(["updated", "created", "priority", "number", "due"]).default("updated"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type TicketFilter = z.output<typeof ticketFilterSchema>;

export function filterWhere(actor: Actor, f: Partial<TicketFilter>): Prisma.TicketWhereInput {
  const uid = actorUserId(actor);
  const and: Prisma.TicketWhereInput[] = [{ deletedAt: null }, ticketVisibilityWhere(actor)];
  if (f.status?.length) and.push({ status: { in: f.status } });
  if (f.statusCategory?.length) and.push({ statusCategory: { in: f.statusCategory } });
  if (f.open === "true") and.push({ statusCategory: { in: OPEN_CATEGORIES } });
  if (f.open === "false") and.push({ statusCategory: { notIn: OPEN_CATEGORIES } });
  if (f.priority?.length) and.push({ priority: { in: f.priority } });
  if (f.type?.length) and.push({ type: { key: { in: f.type } } });
  if (f.teamId?.length) {
    const ids = f.teamId.filter((t) => t !== "none");
    const or: Prisma.TicketWhereInput[] = [];
    if (ids.length) or.push({ teamId: { in: ids } });
    if (f.teamId.includes("none")) or.push({ teamId: null });
    and.push({ OR: or });
  }
  if (f.assignee === "me") and.push({ assigneeId: uid ?? "__none__" });
  else if (f.assignee === "none") and.push({ assigneeId: null });
  else if (f.assignee) and.push({ assigneeId: f.assignee });
  if (f.requesterId) and.push({ requesterId: f.requesterId });
  if (f.organizationId) and.push({ organizationId: f.organizationId });
  if (f.categoryId) and.push({ OR: [{ categoryId: f.categoryId }, { category: { parent: { id: f.categoryId } } }, { category: { parent: { parent: { id: f.categoryId } } } }] });
  if (f.tag) and.push({ tags: { some: { tag: { name: f.tag.toLowerCase() } } } });
  if (f.watching && uid) and.push({ watchers: { some: { userId: uid } } });
  if (f.createdFrom) and.push({ createdAt: { gte: new Date(`${f.createdFrom}T00:00:00Z`) } });
  if (f.createdTo) and.push({ createdAt: { lt: new Date(new Date(`${f.createdTo}T00:00:00Z`).getTime() + 86_400_000) } });
  if (f.q) {
    const q = f.q.trim();
    and.push({
      OR: [{ number: { equals: q.toUpperCase() } }, { title: { contains: q, mode: "insensitive" } }, { requester: { email: { contains: q, mode: "insensitive" } } }, { requester: { name: { contains: q, mode: "insensitive" } } }],
    });
  }
  return { AND: and };
}

export const listInclude = {
  type: { select: { key: true, name: true } },
  requester: { select: { id: true, name: true, email: true } },
  assignee: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  organization: { select: { id: true, name: true } },
  tags: { include: { tag: { select: { name: true } } } },
  slaInstances: { select: { metric: true, status: true, dueAt: true, warnAt: true, breachedAt: true } },
} satisfies Prisma.TicketInclude;

export type TicketListItem = Prisma.TicketGetPayload<{ include: typeof listInclude }>;

export async function listTickets(actor: Actor, f: TicketFilter) {
  if (!canAny(actor, ["ticket.view_all", "ticket.view_team", "ticket.view_own", "ticket.view_org"])) throw new ForbiddenError("ticket.view_own");
  const cfg = getConfig();
  const where = filterWhere(actor, f);
  let orderBy: Prisma.TicketOrderByWithRelationInput[] = [{ updatedAt: f.dir }];
  if (f.sort === "created") orderBy = [{ createdAt: f.dir }];
  if (f.sort === "number") orderBy = [{ number: f.dir }];
  if (f.sort === "due") orderBy = [{ dueAt: { sort: f.dir, nulls: "last" } }, { createdAt: "asc" }];

  if (f.sort === "priority") {
    // Priority order comes from config, so sort in memory over the matching set (capped).
    const all = await db.ticket.findMany({ where, include: listInclude, orderBy: { createdAt: "asc" }, take: 2000 });
    const rank = new Map(cfg.priorities.levels.map((l, i) => [l.key, i]));
    all.sort((a, b) => ((rank.get(a.priority) ?? 99) - (rank.get(b.priority) ?? 99)) * (f.dir === "asc" ? -1 : 1));
    return { total: all.length, page: f.page, pageSize: f.pageSize, items: all.slice((f.page - 1) * f.pageSize, f.page * f.pageSize) };
  }

  const [total, items] = await Promise.all([
    db.ticket.count({ where }),
    db.ticket.findMany({ where, include: listInclude, orderBy, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
  ]);
  return { total, page: f.page, pageSize: f.pageSize, items };
}

// ─── Update ────────────────────────────────────────────────────────────────

export const updateTicketSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().max(200_000).optional(),
  priority: z.string().max(60).optional(),
  impact: z.string().max(60).nullable().optional(),
  urgency: z.string().max(60).nullable().optional(),
  categoryId: z.string().max(64).nullable().optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  // Problem / change management
  rootCause: z.string().max(20_000).nullable().optional(),
  workaround: z.string().max(20_000).nullable().optional(),
  knownError: z.boolean().optional(),
  riskLevel: z.string().max(60).nullable().optional(),
  changePlan: z.string().max(20_000).nullable().optional(),
  rollbackPlan: z.string().max(20_000).nullable().optional(),
  plannedStartAt: z.iso.datetime().nullable().optional(),
  plannedEndAt: z.iso.datetime().nullable().optional(),
});
export type UpdateTicketInput = z.input<typeof updateTicketSchema>;

export async function updateTicket(actor: Actor, id: string, rawInput: UpdateTicketInput, opts: { ctx?: AuditContext; depth?: number } = {}) {
  assertCan(actor, "ticket.update");
  const input = updateTicketSchema.parse(rawInput);
  const cfg = getConfig();
  const ticket = await getTicket(actor, id);
  const typeCfg = typeConfigOrThrow(cfg, ticket.type.key);
  assertModulePermission(actor, typeCfg);
  if (input.riskLevel !== undefined && input.riskLevel !== ticket.riskLevel && ticket.cabStatus === "PENDING") {
    throw new ValidationError("The risk level can't change while the CAB is reviewing this change");
  }

  assertKnown(cfg.priorities.levels, input.priority, "priority");
  assertKnown(cfg.priorities.impact, input.impact, "impact");
  assertKnown(cfg.priorities.urgency, input.urgency, "urgency");
  assertKnown(cfg.itsm.riskLevels, input.riskLevel, "riskLevel");
  const fieldValues = input.fields ? (buildFieldValuesSchema(typeCfg.fields, { mode: "update", audience: "agent" }).parse(input.fields) as Record<string, unknown>) : undefined;
  if (input.categoryId && !(await db.category.findFirst({ where: { id: input.categoryId, isActive: true } }))) throw new ValidationError("Unknown category");

  const data: Prisma.TicketUpdateInput = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const set = <K extends keyof typeof ticket>(key: K, value: unknown, dataKey: string = key as string) => {
    if (value === undefined) return;
    const before = ticket[key] instanceof Date ? (ticket[key] as Date).toISOString() : ticket[key];
    if (JSON.stringify(before) === JSON.stringify(value)) return;
    changes[key as string] = { from: before, to: value };
    (data as Record<string, unknown>)[dataKey] = typeof value === "string" && /At$/.test(key as string) ? new Date(value) : value;
  };

  set("title", input.title);
  if (input.description !== undefined) {
    const d = richText(input.description);
    if (d.html !== ticket.description) {
      data.description = d.html;
      data.descriptionText = d.text;
      changes.description = { from: "…", to: "updated" };
    }
  }
  // Impact/urgency recompute priority unless priority is set explicitly.
  set("impact", input.impact);
  set("urgency", input.urgency);
  let priority = input.priority;
  if (!priority && (input.impact !== undefined || input.urgency !== undefined)) {
    const impact = input.impact !== undefined ? input.impact : ticket.impact;
    const urgency = input.urgency !== undefined ? input.urgency : ticket.urgency;
    if (impact && urgency) priority = priorityFromMatrix(cfg, impact, urgency);
  }
  set("priority", priority);
  if (input.categoryId !== undefined && input.categoryId !== ticket.categoryId) {
    changes.categoryId = { from: ticket.categoryId, to: input.categoryId };
    data.category = input.categoryId ? { connect: { id: input.categoryId } } : { disconnect: true };
  }
  set("dueAt", input.dueAt);
  for (const k of ["rootCause", "workaround", "knownError", "riskLevel", "changePlan", "rollbackPlan", "plannedStartAt", "plannedEndAt"] as const) set(k, input[k]);

  await db.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.ticket.update({ where: { id: ticket.id }, data });
    if (fieldValues) {
      const before = ticketFieldValues(ticket);
      for (const [k, v] of Object.entries(fieldValues)) {
        if (JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null)) changes[`field.${k}`] = { from: before[k] ?? null, to: v };
      }
      await writeFieldValues(tx, ticket.id, ticket.typeId, typeCfg.fields, fieldValues);
      // Newly chosen assets in asset fields get linked (old links stay as history).
      for (const f of typeCfg.fields.filter((x) => x.type === "asset")) {
        const assetId = fieldValues[f.key];
        if (typeof assetId !== "string" || !assetId || assetId === before[f.key]) continue;
        if (!(await tx.asset.findFirst({ where: { id: assetId, deletedAt: null } }))) throw new ValidationError("Unknown asset", { [f.key]: "unknown" });
        await tx.relationship.upsert({
          where: { type_sourceTicketId_targetAssetId: { type: RelationshipType.AFFECTS_ASSET, sourceTicketId: ticket.id, targetAssetId: assetId } },
          create: { type: RelationshipType.AFFECTS_ASSET, sourceTicketId: ticket.id, targetAssetId: assetId, createdById: actorUserId(actor) },
          update: {},
        });
      }
    }
    if (input.tags) {
      const beforeTags = ticket.tags.map((t) => t.tag.name).sort();
      const tagIds = await upsertTags(tx, input.tags);
      await tx.ticketTag.deleteMany({ where: { ticketId: ticket.id } });
      await tx.ticketTag.createMany({ data: tagIds.map((tagId) => ({ ticketId: ticket.id, tagId })) });
      const after = input.tags.map((t) => t.toLowerCase()).sort();
      if (JSON.stringify(beforeTags) !== JSON.stringify(after)) changes.tags = { from: beforeTags, to: after };
    }
    if (Object.keys(changes).length) await tx.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
  });

  if (Object.keys(changes).length) {
    await audit(actor, { action: "ticket.update", entityType: "ticket", entityId: ticket.id, changes }, opts.ctx);
    await emitTicketEvent("ticket.updated", ticket.id, actor, { changes, depth: opts.depth });
  }
  return { id: ticket.id, changes };
}

// ─── Assign ────────────────────────────────────────────────────────────────

export const assignSchema = z.object({
  teamId: z.string().max(64).nullable().optional(),
  assigneeId: z.string().max(64).nullable().optional(),
});

export async function assignTicket(actor: Actor, id: string, input: z.infer<typeof assignSchema>, opts: { ctx?: AuditContext; depth?: number } = {}) {
  const ticket = await getTicket(actor, id);
  const uid = actorUserId(actor);
  const teamId = input.teamId !== undefined ? input.teamId : ticket.teamId;
  let assigneeId = input.assigneeId !== undefined ? input.assigneeId : ticket.assigneeId;

  if (actor.kind !== "system" && !can(actor, "ticket.reassign")) {
    assertCan(actor, "ticket.assign");
    // ticket.assign: take it yourself, release it, or move within your own teams.
    const ownTeams = actor.teamIds;
    if (teamId !== ticket.teamId && teamId && !ownTeams.includes(teamId)) throw new ForbiddenError("ticket.reassign", "You can only move tickets between your own teams");
    if (assigneeId && assigneeId !== uid) {
      const memberOfTeam = teamId ? await db.teamMember.findFirst({ where: { teamId, userId: assigneeId } }) : null;
      if (!memberOfTeam || !teamId || !ownTeams.includes(teamId)) throw new ForbiddenError("ticket.reassign", "You can only assign to members of your teams");
    }
    if (ticket.assigneeId && ticket.assigneeId !== uid && assigneeId !== ticket.assigneeId) {
      throw new ForbiddenError("ticket.reassign", "This ticket is assigned to someone else");
    }
  }
  if (teamId && !(await db.team.findFirst({ where: { id: teamId, isActive: true } }))) throw new ValidationError("Unknown team");
  if (assigneeId) {
    const ok = await db.user.findFirst({ where: { id: assigneeId, ...agentUserWhere() } });
    if (!ok) throw new ValidationError("Assignee must be an active agent", { assigneeId: "not an agent" });
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  await db.$transaction(async (tx) => {
    // Moving to another team without choosing a person: let the new team's strategy pick.
    if (teamId !== ticket.teamId && input.assigneeId === undefined) {
      assigneeId = teamId ? await autoAssign(tx, teamId) : null;
    }
    if (teamId !== ticket.teamId) changes.teamId = { from: ticket.teamId, to: teamId };
    if (assigneeId !== ticket.assigneeId) changes.assigneeId = { from: ticket.assigneeId, to: assigneeId };
    if (Object.keys(changes).length) await tx.ticket.update({ where: { id: ticket.id }, data: { teamId, assigneeId } });
  });
  if (!Object.keys(changes).length) return { id: ticket.id, changes };

  const [teamName, assigneeName] = await Promise.all([
    teamId ? db.team.findUnique({ where: { id: teamId }, select: { name: true } }) : null,
    assigneeId ? db.user.findUnique({ where: { id: assigneeId }, select: { name: true } }) : null,
  ]);
  await audit(actor, { action: "ticket.assign", entityType: "ticket", entityId: ticket.id, changes: { ...changes, team: teamName?.name ?? null, assignee: assigneeName?.name ?? null } }, opts.ctx);
  await emitTicketEvent("ticket.assigned", ticket.id, actor, { changes, depth: opts.depth });
  return { id: ticket.id, changes };
}

// ─── Transition ────────────────────────────────────────────────────────────

export const transitionSchema = z.object({
  to: z.string().min(1).max(60),
  comment: z.string().max(200_000).optional(),
  commentVisibility: z.enum(CommentVisibility).optional(),
});

export async function transitionTicket(actor: Actor, id: string, input: z.infer<typeof transitionSchema>, opts: { ctx?: AuditContext; depth?: number; reason?: string } = {}) {
  const cfg = getConfig();
  const ticket = await getTicket(actor, id);
  const uid = actorUserId(actor);
  const isRequester = uid === ticket.requesterId;
  if (actor.kind !== "system" && !can(actor, "ticket.transition") && !isRequester) throw new ForbiddenError("ticket.transition");
  const typeCfg = typeConfigOrThrow(cfg, ticket.type.key);
  if (!isRequester) assertModulePermission(actor, typeCfg);
  const commentText = input.comment ? richText(input.comment) : null;
  const rule = resolveTransition(typeCfg, ticket.status, input.to, workflowActorFor(actor, ticket), commentText?.text);
  if (typeCfg.feature === "changeManagement") await (await import("./changes")).assertChangeTransition(actor, ticket, rule.to);
  const target = stateOf(typeCfg, rule.to)!;
  const category = CATEGORY_MAP[target.category]!;
  const now = new Date();
  const wasDone = ticket.statusCategory === StatusCategory.RESOLVED || ticket.statusCategory === StatusCategory.CLOSED;
  const isDone = category === StatusCategory.RESOLVED || category === StatusCategory.CLOSED;

  let commentId: string | undefined;
  await db.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        status: target.key,
        statusCategory: category,
        resolvedAt: category === StatusCategory.RESOLVED ? now : isDone ? (ticket.resolvedAt ?? now) : null,
        closedAt: category === StatusCategory.CLOSED ? now : null,
        reopenCount: wasDone && !isDone ? { increment: 1 } : undefined,
      },
    });
    await tx.statusHistory.create({ data: { ticketId: ticket.id, fromStatus: ticket.status, toStatus: target.key, changedById: uid, reason: opts.reason ?? null } });
    if (commentText?.text) {
      // Requesters' comments are always public; staff default to public when resolving, internal otherwise.
      const visibility = !canSeeInternal(actor) ? CommentVisibility.PUBLIC : (input.commentVisibility ?? (isDone ? CommentVisibility.PUBLIC : CommentVisibility.INTERNAL));
      if (visibility === CommentVisibility.INTERNAL && actor.kind !== "system") assertCan(actor, "ticket.comment_internal");
      const c = await tx.comment.create({ data: { ticketId: ticket.id, authorId: uid, body: commentText.html, bodyText: commentText.text, visibility, source: CommentSource.WEB } });
      commentId = c.id;
      if (visibility === CommentVisibility.PUBLIC && isAgent(actor) && !ticket.firstRespondedAt && uid !== ticket.requesterId) {
        await tx.ticket.update({ where: { id: ticket.id }, data: { firstRespondedAt: now } });
      }
    }
  });

  const changes = { status: { from: ticket.status, to: target.key }, statusCategory: { from: ticket.statusCategory, to: category } };
  await audit(actor, { action: "ticket.transition", entityType: "ticket", entityId: ticket.id, changes }, opts.ctx);
  await emitTicketEvent("ticket.status_changed", ticket.id, actor, { changes, commentId, depth: opts.depth });
  if (commentId) await emitTicketEvent("ticket.commented", ticket.id, actor, { commentId, depth: opts.depth, viaTransition: true });
  return { id: ticket.id, status: target.key, statusCategory: category };
}

// ─── Comments ──────────────────────────────────────────────────────────────

export const commentSchema = z.object({
  body: z.string().min(1).max(200_000),
  format: z.enum(["html", "text"]).default("html"),
  visibility: z.enum(CommentVisibility).default(CommentVisibility.PUBLIC),
  attachmentIds: z.array(z.string().max(64)).max(20).default([]),
});

export type CommentOptions = { source?: CommentSource; emailMessageId?: string | null; ctx?: AuditContext; depth?: number; authorId?: string | null };

export async function addComment(actor: Actor, ticketId: string, rawInput: z.input<typeof commentSchema>, opts: CommentOptions = {}) {
  const input = commentSchema.parse(rawInput);
  const cfg = getConfig();
  const ticket = await getTicket(actor, ticketId);
  const uid = opts.authorId !== undefined ? opts.authorId : actorUserId(actor);
  const staff = actor.kind === "system" || isAgent(actor);

  if (input.visibility === CommentVisibility.INTERNAL) {
    if (actor.kind !== "system") assertCan(actor, "ticket.comment_internal");
  } else if (actor.kind !== "system") {
    assertCan(actor, "ticket.reply");
  }

  const body = input.format === "text" ? richText(plainTextToHtml(input.body)) : richText(input.body);
  if (!body.text && !input.attachmentIds.length) throw new ValidationError("Comment is empty");
  // Mentions only make sense for staff-to-staff; drop mention ids that aren't agents.
  const mentionIds = extractMentionIds(body.html);
  const mentions = mentionIds.length ? (await db.user.findMany({ where: { id: { in: mentionIds }, ...agentUserWhere() }, select: { id: true } })).map((u) => u.id) : [];

  const now = new Date();
  const comment = await db.$transaction(async (tx) => {
    const c = await tx.comment.create({
      data: {
        ticketId: ticket.id,
        authorId: uid,
        body: body.html,
        bodyText: body.text,
        visibility: input.visibility,
        source: opts.source ?? CommentSource.WEB,
        emailMessageId: opts.emailMessageId ?? null,
        mentions,
      },
    });
    if (input.attachmentIds.length) {
      await tx.attachment.updateMany({
        where: { id: { in: input.attachmentIds }, commentId: null, OR: [{ ticketId: null }, { ticketId: ticket.id }], ...(uid ? { uploaderId: uid } : {}) },
        data: { ticketId: ticket.id, commentId: c.id },
      });
    }
    const touch: Prisma.TicketUpdateInput = { updatedAt: now };
    if (input.visibility === CommentVisibility.PUBLIC && staff && uid !== ticket.requesterId && !ticket.firstRespondedAt) touch.firstRespondedAt = now;
    await tx.ticket.update({ where: { id: ticket.id }, data: touch });
    // Mentioned agents start watching so they hear about replies.
    for (const m of mentions) {
      await tx.ticketWatcher.upsert({ where: { ticketId_userId: { ticketId: ticket.id, userId: m } }, create: { ticketId: ticket.id, userId: m }, update: {} });
    }
    return c;
  });

  await emitTicketEvent("ticket.commented", ticket.id, actor, { commentId: comment.id, depth: opts.depth });

  // A requester replying to a pending/resolved ticket moves it back into the queue.
  const fromRequester = uid !== null && uid === ticket.requesterId;
  if (fromRequester && input.visibility === CommentVisibility.PUBLIC) {
    const reopen =
      (ticket.statusCategory === StatusCategory.RESOLVED && cfg.portal.reopenOnReply) || ticket.statusCategory === StatusCategory.PENDING;
    if (reopen) {
      const typeCfg = getTicketTypeConfig(cfg, ticket.type.key);
      const target = cfg.portal.reopenStatus;
      if (typeCfg && stateOf(typeCfg, target) && target !== ticket.status) {
        try {
          await transitionTicket({ kind: "system", label: "requester-reply" }, ticket.id, { to: target }, { reason: "requester replied", depth: opts.depth });
        } catch {
          // No configured transition from this state — leave the status alone.
        }
      }
    }
  }
  return { id: comment.id };
}

export async function deleteComment(actor: Actor, commentId: string, ctx?: AuditContext) {
  const comment = await db.comment.findUnique({ where: { id: commentId } });
  if (!comment || comment.deletedAt) throw new NotFoundError("Comment");
  await getTicket(actor, comment.ticketId);
  const uid = actorUserId(actor);
  if (comment.authorId !== uid && !can(actor, "ticket.delete")) throw new ForbiddenError("ticket.delete", "You can only delete your own comments");
  await db.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
  await audit(actor, { action: "comment.delete", entityType: "ticket", entityId: comment.ticketId, changes: { commentId } }, ctx);
  return { id: commentId };
}

// ─── Watchers ──────────────────────────────────────────────────────────────

export const watchersSchema = z.object({
  add: z.array(z.string().max(64)).max(50).default([]),
  remove: z.array(z.string().max(64)).max(50).default([]),
  addEmails: z.array(z.email()).max(20).default([]),
  removeEmails: z.array(z.email()).max(20).default([]),
});

export async function updateWatchers(actor: Actor, ticketId: string, input: z.infer<typeof watchersSchema>, ctx?: AuditContext) {
  const ticket = await getTicket(actor, ticketId);
  const uid = actorUserId(actor);
  // Anyone who can see the ticket may watch/unwatch themselves; managing others needs ticket.update.
  const onlySelf = [...input.add, ...input.remove].every((u) => u === uid) && !input.addEmails.length && !input.removeEmails.length;
  if (!onlySelf) assertCan(actor, "ticket.update");
  await db.$transaction(async (tx) => {
    await validateUserIds(tx, input.add);
    for (const userId of input.add) {
      await tx.ticketWatcher.upsert({ where: { ticketId_userId: { ticketId: ticket.id, userId } }, create: { ticketId: ticket.id, userId }, update: {} });
    }
    for (const email of input.addEmails.map(normalizeEmail)) {
      await tx.ticketWatcher.upsert({ where: { ticketId_email: { ticketId: ticket.id, email } }, create: { ticketId: ticket.id, email }, update: {} });
    }
    if (input.remove.length) await tx.ticketWatcher.deleteMany({ where: { ticketId: ticket.id, userId: { in: input.remove } } });
    if (input.removeEmails.length) await tx.ticketWatcher.deleteMany({ where: { ticketId: ticket.id, email: { in: input.removeEmails.map(normalizeEmail) } } });
  });
  await audit(actor, { action: "ticket.watchers", entityType: "ticket", entityId: ticket.id, changes: input }, ctx);
  return { id: ticket.id };
}

// ─── Links & merge ─────────────────────────────────────────────────────────

export const linkSchema = z.object({
  type: z.enum(RelationshipType),
  /** Ticket number or id of the other ticket. */
  target: z.string().max(64).optional(),
  assetId: z.string().max(64).optional(),
});

export async function linkTicket(actor: Actor, ticketId: string, input: z.infer<typeof linkSchema>, ctx?: AuditContext) {
  assertCan(actor, "ticket.link");
  const source = await getTicket(actor, ticketId);
  if (input.type === RelationshipType.AFFECTS_ASSET) {
    if (!input.assetId) throw new ValidationError("assetId is required");
    const asset = await db.asset.findFirst({ where: { id: input.assetId, deletedAt: null } });
    if (!asset) throw new ValidationError("Unknown asset");
    const rel = await db.relationship.upsert({
      where: { type_sourceTicketId_targetAssetId: { type: input.type, sourceTicketId: source.id, targetAssetId: asset.id } },
      create: { type: input.type, sourceTicketId: source.id, targetAssetId: asset.id, createdById: actorUserId(actor) },
      update: {},
    });
    await audit(actor, { action: "ticket.link", entityType: "ticket", entityId: source.id, changes: { type: input.type, asset: asset.tag } }, ctx);
    return { id: rel.id };
  }
  if (!input.target) throw new ValidationError("target is required");
  const target = await getTicket(actor, input.target.toUpperCase().match(/^[A-Z]{2,6}\d+$/) ? input.target.toUpperCase() : input.target);
  if (target.id === source.id) throw new ValidationError("A ticket can't be linked to itself");
  if (input.type === RelationshipType.PARENT_CHILD) {
    // Prevent cycles: the new child must not be an ancestor of the parent.
    let cursor: string | null = source.id;
    for (let i = 0; cursor && i < 20; i++) {
      if (cursor === target.id) throw new ValidationError("That would create a parent/child loop");
      const up: { sourceTicketId: string } | null = await db.relationship.findFirst({ where: { type: RelationshipType.PARENT_CHILD, targetTicketId: cursor }, select: { sourceTicketId: true } });
      cursor = up?.sourceTicketId ?? null;
    }
  }
  const existing = await db.relationship.findFirst({
    where: {
      type: input.type,
      OR: [
        { sourceTicketId: source.id, targetTicketId: target.id },
        ...(input.type === RelationshipType.RELATED ? [{ sourceTicketId: target.id, targetTicketId: source.id }] : []),
      ],
    },
  });
  if (existing) throw new ConflictError("These tickets are already linked that way");
  const rel = await db.relationship.create({ data: { type: input.type, sourceTicketId: source.id, targetTicketId: target.id, createdById: actorUserId(actor) } });
  await audit(actor, { action: "ticket.link", entityType: "ticket", entityId: source.id, changes: { type: input.type, target: target.number } }, ctx);
  await audit(actor, { action: "ticket.link", entityType: "ticket", entityId: target.id, changes: { type: input.type, source: source.number } }, ctx);
  return { id: rel.id };
}

export async function unlinkTicket(actor: Actor, ticketId: string, relationshipId: string, ctx?: AuditContext) {
  assertCan(actor, "ticket.link");
  const ticket = await getTicket(actor, ticketId);
  const rel = await db.relationship.findUnique({ where: { id: relationshipId } });
  if (!rel || (rel.sourceTicketId !== ticket.id && rel.targetTicketId !== ticket.id)) throw new NotFoundError("Link");
  await db.relationship.delete({ where: { id: rel.id } });
  await audit(actor, { action: "ticket.unlink", entityType: "ticket", entityId: ticket.id, changes: { type: rel.type } }, ctx);
  return { id: rel.id };
}

/**
 * Merge `sourceId` into `targetId`: comments and attachments move to the
 * target, requester and watchers of the source become watchers of the target,
 * and the source is closed with a link to the target. Merging bypasses the
 * workflow on purpose (it's an administrative action).
 */
export async function mergeTickets(actor: Actor, sourceId: string, target: string, ctx?: AuditContext) {
  assertCan(actor, "ticket.link");
  const cfg = getConfig();
  const source = await getTicket(actor, sourceId);
  const dest = await getTicket(actor, target);
  if (source.id === dest.id) throw new ValidationError("Can't merge a ticket into itself");
  if (source.mergedIntoId) throw new ValidationError("This ticket was already merged");
  const typeCfg = typeConfigOrThrow(cfg, source.type.key);
  const closed = typeCfg.workflow.states.find((s) => s.category === "closed") ?? typeCfg.workflow.states.find((s) => s.category === "resolved");
  if (!closed) throw new ValidationError(`${typeCfg.name} has no closed state to merge into`);
  const uid = actorUserId(actor);
  const now = new Date();

  await db.$transaction(async (tx) => {
    await tx.comment.updateMany({ where: { ticketId: source.id }, data: { ticketId: dest.id } });
    await tx.attachment.updateMany({ where: { ticketId: source.id }, data: { ticketId: dest.id } });
    const watcherUserIds = [source.requesterId, ...source.watchers.flatMap((w) => (w.userId ? [w.userId] : []))].filter((u) => u !== dest.requesterId);
    for (const userId of new Set(watcherUserIds)) {
      await tx.ticketWatcher.upsert({ where: { ticketId_userId: { ticketId: dest.id, userId } }, create: { ticketId: dest.id, userId }, update: {} });
    }
    for (const w of source.watchers.filter((w) => w.email)) {
      await tx.ticketWatcher.upsert({ where: { ticketId_email: { ticketId: dest.id, email: w.email! } }, create: { ticketId: dest.id, email: w.email! }, update: {} });
    }
    const srcBody = richText(`<p>Merged into <strong>${dest.number}</strong>. Further updates happen there.</p>`);
    const dstBody = richText(`<p><strong>${source.number}</strong> (${escapeHtml(source.title)}) was merged into this ticket.</p><blockquote>${source.description || "<p>(no description)</p>"}</blockquote>`);
    await tx.comment.create({ data: { ticketId: source.id, authorId: uid, body: srcBody.html, bodyText: srcBody.text, visibility: CommentVisibility.PUBLIC, source: CommentSource.SYSTEM, isSystem: true } });
    await tx.comment.create({ data: { ticketId: dest.id, authorId: uid, body: dstBody.html, bodyText: dstBody.text, visibility: CommentVisibility.INTERNAL, source: CommentSource.SYSTEM, isSystem: true } });
    await tx.ticket.update({
      where: { id: source.id },
      data: { mergedIntoId: dest.id, status: closed.key, statusCategory: CATEGORY_MAP[closed.category]!, closedAt: now, resolvedAt: source.resolvedAt ?? now },
    });
    await tx.statusHistory.create({ data: { ticketId: source.id, fromStatus: source.status, toStatus: closed.key, changedById: uid, reason: `merged into ${dest.number}` } });
    await tx.relationship.upsert({
      where: { type_sourceTicketId_targetTicketId: { type: RelationshipType.DUPLICATE_OF, sourceTicketId: source.id, targetTicketId: dest.id } },
      create: { type: RelationshipType.DUPLICATE_OF, sourceTicketId: source.id, targetTicketId: dest.id, createdById: uid },
      update: {},
    });
  });
  await audit(actor, { action: "ticket.merge", entityType: "ticket", entityId: source.id, changes: { into: dest.number } }, ctx);
  await audit(actor, { action: "ticket.merge", entityType: "ticket", entityId: dest.id, changes: { from: source.number } }, ctx);
  await emitTicketEvent("ticket.merged", source.id, actor, { changes: { mergedInto: { from: null, to: dest.id } } });
  return { id: dest.id, number: dest.number };
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Delete ────────────────────────────────────────────────────────────────

export async function deleteTicket(actor: Actor, id: string, ctx?: AuditContext) {
  assertCan(actor, "ticket.delete");
  const ticket = await getTicket(actor, id);
  await db.ticket.update({ where: { id: ticket.id }, data: { deletedAt: new Date() } });
  await audit(actor, { action: "ticket.delete", entityType: "ticket", entityId: ticket.id, changes: { number: ticket.number } }, ctx);
  await emitTicketEvent("ticket.deleted", ticket.id, actor);
  return { id: ticket.id };
}

// ─── Bulk ──────────────────────────────────────────────────────────────────

export const bulkSchema = z.object({
  ids: z.array(z.string().max(64)).min(1).max(200),
  status: z.string().max(60).optional(),
  comment: z.string().max(20_000).optional(),
  priority: z.string().max(60).optional(),
  teamId: z.string().max(64).nullable().optional(),
  assigneeId: z.string().max(64).nullable().optional(),
  addTags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  delete: z.boolean().optional(),
});

export async function bulkUpdate(actor: Actor, input: z.infer<typeof bulkSchema>, ctx?: AuditContext) {
  assertCan(actor, "ticket.bulk");
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of input.ids) {
    try {
      if (input.delete) {
        await deleteTicket(actor, id, ctx);
      } else {
        if (input.teamId !== undefined || input.assigneeId !== undefined) await assignTicket(actor, id, { teamId: input.teamId, assigneeId: input.assigneeId }, { ctx });
        if (input.priority || input.addTags?.length) {
          const t = input.addTags?.length ? await getTicket(actor, id) : null;
          await updateTicket(actor, id, { priority: input.priority, tags: t ? [...t.tags.map((x) => x.tag.name), ...input.addTags!] : undefined }, { ctx });
        }
        if (input.status) {
          const t = await getTicket(actor, id);
          if (t.status !== input.status) await transitionTicket(actor, id, { to: input.status, comment: input.comment }, { ctx });
        }
      }
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: (err as Error).message });
    }
  }
  return { results, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
}
