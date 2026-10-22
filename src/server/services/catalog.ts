/**
 * Service catalog: requestable items with their own forms, optional approval.
 *
 * Submitting an item creates a ticket (type/team/priority from the item) and a
 * CatalogRequest holding the form data. Items that need approval wait
 * unassigned until an approver decides: approval assigns the ticket via the
 * team's strategy; rejection closes it with the approver's reason.
 */
import { z } from "zod";
import { getConfig } from "@/core/config/loader";
import { activeTicketTypes } from "@/core/config/helpers";
import { fieldSchema, type FieldConfig } from "@/core/config/schema";
import { actorUserId, assertCan, can, systemActor, type Actor } from "@/core/rbac/actor";
import { NotFoundError, ValidationError, ForbiddenError, ConflictError } from "@/core/errors";
import { buildFieldValuesSchema, displayValue, fillRequiredFields } from "@/core/tickets/fields";
import { ApprovalKind, ApprovalStatus, CommentSource, CommentVisibility, StatusCategory } from "@/generated/prisma/enums";
import { audit, type AuditContext } from "../audit";
import { db } from "../db";
import { emitTicketEvent } from "../events";
import { queueEmail } from "../mail/outbound";
import { appUrl } from "../mail/templates";
import { richText } from "../richtext";
import { autoAssign, CATEGORY_MAP, createTicket } from "./tickets";
import { notifyUsers } from "./notifications";
import { WILDCARD } from "@/core/rbac/permissions";

function assertCatalogEnabled() {
  if (!getConfig().features.serviceCatalog) throw new NotFoundError("Service catalog");
}

export function itemFields(item: { fields: unknown }): FieldConfig[] {
  const parsed = z.array(fieldSchema).safeParse(item.fields);
  return parsed.success ? parsed.data : [];
}

export async function listCatalogItems(actor: Actor, opts: { includeInactive?: boolean } = {}) {
  assertCatalogEnabled();
  assertCan(actor, "catalog.request");
  const manage = can(actor, "catalog.manage");
  return db.catalogItem.findMany({
    where: opts.includeInactive && manage ? {} : { isActive: true },
    orderBy: [{ group: "asc" }, { order: "asc" }, { name: "asc" }],
    include: { team: { select: { id: true, name: true } } },
  });
}

export async function getCatalogItem(actor: Actor, keyOrId: string) {
  assertCatalogEnabled();
  assertCan(actor, "catalog.request");
  const item = await db.catalogItem.findFirst({ where: { OR: [{ key: keyOrId }, { id: keyOrId }], ...(can(actor, "catalog.manage") ? {} : { isActive: true }) }, include: { team: { select: { id: true, name: true } } } });
  if (!item) throw new NotFoundError("Catalog item");
  return item;
}

export const catalogRequestSchema = z.object({
  values: z.record(z.string(), z.unknown()).default({}),
  notes: z.string().max(10_000).optional(),
  attachmentIds: z.array(z.string().max(64)).max(20).default([]),
  /** Agents may request on behalf of someone. */
  requesterId: z.string().max(64).optional(),
});

async function approversFor(item: { approverIds: string[] }): Promise<{ id: string; name: string; email: string; notifyByEmail: boolean }[]> {
  if (item.approverIds.length) {
    return db.user.findMany({ where: { id: { in: item.approverIds }, isActive: true }, select: { id: true, name: true, email: true, notifyByEmail: true } });
  }
  // Nobody named: anyone holding catalog.approve (directly or via the admin wildcard).
  return db.user.findMany({
    where: { isActive: true, roles: { some: { role: { OR: [{ permissions: { has: "catalog.approve" } }, { permissions: { has: WILDCARD } }] } } } },
    select: { id: true, name: true, email: true, notifyByEmail: true },
    take: 20,
  });
}

export async function submitCatalogRequest(actor: Actor, keyOrId: string, raw: z.input<typeof catalogRequestSchema>, ctx?: AuditContext) {
  const input = catalogRequestSchema.parse(raw);
  const item = await getCatalogItem(actor, keyOrId);
  if (!item.isActive) throw new ValidationError("This item can't be requested right now");
  const cfg = getConfig();
  const fields = itemFields(item);
  const values = buildFieldValuesSchema(fields, { mode: "create", audience: "portal" }).parse(input.values) as Record<string, unknown>;
  const typeCfg = activeTicketTypes(cfg).find((t) => t.key === item.ticketTypeKey);
  if (!typeCfg) throw new ValidationError(`Catalog item points at unknown ticket type "${item.ticketTypeKey}"`);

  let requesterId = actorUserId(actor);
  if (input.requesterId && input.requesterId !== requesterId) {
    assertCan(actor, "ticket.create_on_behalf");
    requesterId = input.requesterId;
  }
  if (!requesterId) throw new ValidationError("A requester is required");

  const assetIds = fields.filter((f) => f.type === "asset").map((f) => values[f.key]).filter((v): v is string => typeof v === "string");
  const userIds = fields.filter((f) => f.type === "user").map((f) => values[f.key]).filter((v): v is string => typeof v === "string");
  const [assets, users] = await Promise.all([
    assetIds.length ? db.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, tag: true, name: true } }) : [],
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
  ]);
  const lookup = (id: string) => assets.find((a) => a.id === id)?.tag ?? users.find((u) => u.id === id)?.name;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = fields.map((f) => `<tr><th>${esc(f.label)}</th><td>${esc(displayValue(f, values[f.key], lookup))}</td></tr>`).join("");
  const description = `<p><strong>${esc(item.name)}</strong></p>${rows ? `<table><tbody>${rows}</tbody></table>` : ""}${input.notes ? `<p>${esc(input.notes).replace(/\n/g, "<br>")}</p>` : ""}`;

  const needsApproval = item.requiresApproval;
  const ticket = await createTicket(
    systemActor("catalog"),
    {
      type: typeCfg.key,
      title: item.name,
      description,
      requesterId,
      teamId: item.teamId ?? undefined,
      // Wait for approval before anyone is assigned.
      assigneeId: needsApproval ? null : undefined,
      priority: item.priority ?? undefined,
      fields: fillRequiredFields(typeCfg.fields, values),
      attachmentIds: [],
    },
    { source: "CATALOG", ctx },
  );
  if (input.attachmentIds.length) {
    await db.attachment.updateMany({ where: { id: { in: input.attachmentIds }, ticketId: null, uploaderId: actorUserId(actor) ?? undefined }, data: { ticketId: ticket.id } });
  }

  const approvers = needsApproval ? await approversFor(item) : [];
  if (needsApproval && approvers.length === 0) throw new ValidationError("No approver is configured for this item. Ask an administrator to add one.");

  const request = await db.catalogRequest.create({
    data: {
      itemId: item.id,
      ticketId: ticket.id,
      requesterId,
      formData: values as object,
      approvalStatus: needsApproval ? ApprovalStatus.PENDING : ApprovalStatus.NOT_REQUIRED,
      approvals: needsApproval ? { create: approvers.map((a) => ({ kind: ApprovalKind.CATALOG, ticketId: ticket.id, approverId: a.id })) } : undefined,
    },
  });

  if (needsApproval) {
    const note = richText(`<p>Waiting for approval from ${approvers.map((a) => esc(a.name)).join(", ")}.</p>`);
    await db.comment.create({ data: { ticketId: ticket.id, body: note.html, bodyText: note.text, visibility: CommentVisibility.INTERNAL, source: CommentSource.SYSTEM, isSystem: true } });
    const requester = await db.user.findUnique({ where: { id: requesterId }, select: { name: true } });
    await notifyUsers(approvers.map((a) => a.id), { type: "approval.requested", title: `Approval needed: ${item.name}`, body: `${requester?.name ?? "Someone"} requested ${item.name} (${ticket.number})`, link: "/agent/approvals", ticketId: ticket.id }, null);
    for (const a of approvers.filter((x) => x.notifyByEmail)) {
      await queueEmail({
        kind: "approval.requested",
        to: a.email,
        subject: `Approval needed: [${ticket.number}] ${item.name}`,
        ticket,
        content: {
          heading: `${requester?.name ?? "Someone"} needs your approval`,
          bodyHtml: richText(description).html,
          facts: [["Request", item.name], ["Ticket", ticket.number]],
          button: { label: "Review request", url: appUrl("/agent/approvals") },
        },
      });
    }
  }
  await audit(actor, { action: "catalog.request", entityType: "ticket", entityId: ticket.id, changes: { item: item.key, approval: request.approvalStatus } }, ctx);
  return { id: ticket.id, number: ticket.number, approvalStatus: request.approvalStatus };
}

// ─── Approvals (catalog now; change CAB in Phase 6 shares the table) ───────

export async function listMyApprovals(actor: Actor, status: "PENDING" | "DECIDED" = "PENDING") {
  const uid = actorUserId(actor);
  if (!uid) return [];
  return db.approval.findMany({
    where: { approverId: uid, ...(status === "PENDING" ? { status: ApprovalStatus.PENDING } : { status: { in: [ApprovalStatus.APPROVED, ApprovalStatus.REJECTED] } }) },
    orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
    take: 100,
    include: {
      ticket: { select: { id: true, number: true, title: true, description: true, priority: true, createdAt: true, requester: { select: { name: true, email: true } }, organization: { select: { name: true } }, riskLevel: true, plannedStartAt: true, plannedEndAt: true, changePlan: true, rollbackPlan: true } },
      catalogRequest: { include: { item: { select: { name: true } } } },
    },
  });
}

export const decisionSchema = z.object({ decision: z.enum([ApprovalStatus.APPROVED, ApprovalStatus.REJECTED]), comment: z.string().trim().max(5000).optional() });

export async function decideApproval(actor: Actor, approvalId: string, input: z.infer<typeof decisionSchema>, ctx?: AuditContext) {
  const uid = actorUserId(actor);
  const approval = await db.approval.findUnique({ where: { id: approvalId }, include: { ticket: { include: { type: true } }, catalogRequest: { include: { item: true } } } });
  if (!approval) throw new NotFoundError("Approval");
  if (approval.approverId !== uid) throw new ForbiddenError(undefined, "This approval isn't assigned to you");
  if (approval.status !== ApprovalStatus.PENDING) throw new ConflictError("This approval was already decided");
  if (approval.kind === ApprovalKind.CATALOG) assertCan(actor, "catalog.request"); // approvers are named explicitly
  if (input.decision === ApprovalStatus.REJECTED && !input.comment) throw new ValidationError("Please give a reason for rejecting");

  await db.approval.update({ where: { id: approval.id }, data: { status: input.decision, comment: input.comment, decidedAt: new Date() } });
  await audit(actor, { action: `approval.${input.decision.toLowerCase()}`, entityType: "ticket", entityId: approval.ticketId, changes: { kind: approval.kind, comment: input.comment } }, ctx);

  if (approval.kind === ApprovalKind.CATALOG) await settleCatalogApproval(actor, approval.catalogRequestId!, input);
  else {
    const { settleCabApproval } = await import("./changes");
    await settleCabApproval(approval.ticketId);
  }
  return { id: approval.id, status: input.decision };
}

/** First decision wins for catalog requests. */
async function settleCatalogApproval(actor: Actor, catalogRequestId: string, input: z.infer<typeof decisionSchema>) {
  const req = await db.catalogRequest.findUniqueOrThrow({ where: { id: catalogRequestId }, include: { item: true, ticket: { include: { type: true, requester: true } } } });
  if (req.approvalStatus !== ApprovalStatus.PENDING) return;
  await db.catalogRequest.update({ where: { id: req.id }, data: { approvalStatus: input.decision } });
  await db.approval.updateMany({ where: { catalogRequestId: req.id, status: ApprovalStatus.PENDING }, data: { status: ApprovalStatus.NOT_REQUIRED } });
  const approverName = actor.kind === "user" ? actor.name : "An approver";
  const t = req.ticket;
  const system = systemActor("approval");

  if (input.decision === ApprovalStatus.APPROVED) {
    const note = richText(`<p>Approved by ${approverName}.${input.comment ? ` “${input.comment}”` : ""}</p>`);
    await db.comment.create({ data: { ticketId: t.id, authorId: actorUserId(actor), body: note.html, bodyText: note.text, visibility: CommentVisibility.PUBLIC, source: CommentSource.SYSTEM, isSystem: true } });
    let assigneeId: string | null = null;
    if (t.teamId && !t.assigneeId) {
      assigneeId = await db.$transaction((tx) => autoAssign(tx, t.teamId!));
      if (assigneeId) await db.ticket.update({ where: { id: t.id }, data: { assigneeId } });
    }
    if (assigneeId) await emitTicketEvent("ticket.assigned", t.id, system, { changes: { assigneeId: { from: null, to: assigneeId } } });
    await queueEmail({
      kind: "approval.approved",
      to: t.requester.email,
      subject: `[${t.number}] ${t.title}`,
      ticket: { id: t.id, number: t.number },
      content: { heading: `Your request for ${req.item.name} was approved`, paragraphs: ["We're on it and will keep you posted."], button: { label: "View request", url: appUrl(`/portal/tickets/${t.number}`) }, replyable: true },
    });
    return;
  }

  // Rejected: close the ticket (administrative bypass of the workflow, like merge).
  const typeCfg = activeTicketTypes(getConfig()).find((x) => x.key === t.type.key);
  const closed = typeCfg?.workflow.states.find((s) => s.category === "closed") ?? typeCfg?.workflow.states.find((s) => s.category === "resolved");
  const note = richText(`<p>Your request was not approved by ${approverName}.</p><p>${(input.comment ?? "").replace(/</g, "&lt;")}</p>`);
  await db.$transaction(async (tx) => {
    await tx.comment.create({ data: { ticketId: t.id, authorId: actorUserId(actor), body: note.html, bodyText: note.text, visibility: CommentVisibility.PUBLIC, source: CommentSource.SYSTEM, isSystem: true } });
    if (closed) {
      const now = new Date();
      await tx.ticket.update({ where: { id: t.id }, data: { status: closed.key, statusCategory: CATEGORY_MAP[closed.category] ?? StatusCategory.CLOSED, closedAt: now, resolvedAt: t.resolvedAt ?? now } });
      await tx.statusHistory.create({ data: { ticketId: t.id, fromStatus: t.status, toStatus: closed.key, changedById: actorUserId(actor), reason: "request rejected" } });
    }
  });
  if (closed) await emitTicketEvent("ticket.status_changed", t.id, system, { changes: { status: { from: t.status, to: closed.key }, statusCategory: { from: t.statusCategory, to: CATEGORY_MAP[closed.category] } } });
  await queueEmail({
    kind: "approval.rejected",
    to: t.requester.email,
    subject: `[${t.number}] ${t.title}`,
    ticket: { id: t.id, number: t.number },
    content: { heading: `Your request for ${req.item.name} was not approved`, paragraphs: input.comment ? [input.comment] : [], button: { label: "View request", url: appUrl(`/portal/tickets/${t.number}`) } },
  });
}

// ─── Catalog administration ────────────────────────────────────────────────

export const catalogItemSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{1,40}$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  group: z.string().max(60).nullable().optional(),
  ticketTypeKey: z.string().max(60),
  teamId: z.string().max(64).nullable().optional(),
  priority: z.string().max(60).nullable().optional(),
  fields: z.array(fieldSchema).max(40).default([]),
  requiresApproval: z.boolean().default(false),
  approverIds: z.array(z.string().max(64)).max(20).default([]),
  isActive: z.boolean().default(true),
  order: z.number().int().min(0).max(1000).default(0),
});

function validateItemRefs(input: Partial<z.infer<typeof catalogItemSchema>>) {
  const cfg = getConfig();
  if (input.ticketTypeKey && !activeTicketTypes(cfg).some((t) => t.key === input.ticketTypeKey)) throw new ValidationError(`Unknown ticket type "${input.ticketTypeKey}"`);
  if (input.priority && !cfg.priorities.levels.some((p) => p.key === input.priority)) throw new ValidationError(`Unknown priority "${input.priority}"`);
}

export async function createCatalogItem(actor: Actor, raw: z.input<typeof catalogItemSchema>, ctx?: AuditContext) {
  assertCatalogEnabled();
  assertCan(actor, "catalog.manage");
  const input = catalogItemSchema.parse(raw);
  validateItemRefs(input);
  if (await db.catalogItem.findUnique({ where: { key: input.key } })) throw new ConflictError("An item with that key exists");
  const item = await db.catalogItem.create({ data: { ...input, fields: input.fields as object[] } });
  await audit(actor, { action: "catalog.item.create", entityType: "catalog_item", entityId: item.id, changes: { key: item.key } }, ctx);
  return { id: item.id };
}

export async function updateCatalogItem(actor: Actor, id: string, raw: Partial<z.input<typeof catalogItemSchema>>, ctx?: AuditContext) {
  assertCatalogEnabled();
  assertCan(actor, "catalog.manage");
  const input = catalogItemSchema.partial().parse(raw);
  validateItemRefs(input);
  const { key: _key, fields, ...rest } = input;
  await db.catalogItem.update({ where: { id }, data: { ...rest, ...(fields ? { fields: fields as object[] } : {}) } });
  await audit(actor, { action: "catalog.item.update", entityType: "catalog_item", entityId: id, changes: rest }, ctx);
  return { id };
}
