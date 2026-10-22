/**
 * Change management: CAB (change advisory board) approvals.
 *
 * When a change enters its "awaiting approval" state (see core/itsm/cab.ts):
 *  - low-risk changes (risk not in itsm.cabRequiredForRisk) are approved
 *    automatically;
 *  - otherwise every CAB member gets an approval request. One rejection
 *    rejects the change; `cabQuorum` approvals approve it, and the change
 *    moves on through the workflow automatically.
 * People can't move a change past the CAB by hand while votes are pending.
 */
import { getConfig } from "@/core/config/loader";
import type { TicketTypeConfig } from "@/core/config/schema";
import { ValidationError } from "@/core/errors";
import { cabOutcome, cabRequired, cabStates } from "@/core/itsm/cab";
import { systemActor, type Actor } from "@/core/rbac/actor";
import { WILDCARD } from "@/core/rbac/permissions";
import { ApprovalKind, ApprovalStatus, CommentSource, CommentVisibility } from "@/generated/prisma/enums";
import { db } from "../db";
import { onTicketEvent, type TicketEvent } from "../events";
import { logger } from "../logger";
import { queueEmail } from "../mail/outbound";
import { appUrl, escapeHtml } from "../mail/templates";
import { richText } from "../richtext";
import { notifyUsers } from "./notifications";

function typeCfg(key: string): TicketTypeConfig | undefined {
  return getConfig().ticketTypes.find((t) => t.key === key);
}

async function systemNote(ticketId: string, html: string, visibility: CommentVisibility = CommentVisibility.INTERNAL) {
  const note = richText(html);
  await db.comment.create({ data: { ticketId, body: note.html, bodyText: note.text, visibility, source: CommentSource.SYSTEM, isSystem: true } });
}

/** Called by transitionTicket before a status change. Throws if the CAB hasn't decided yet. */
export async function assertChangeTransition(actor: Actor, ticket: { id: string; status: string; riskLevel: string | null; cabStatus: string; type: { key: string } }, to: string): Promise<void> {
  if (actor.kind === "system") return;
  const t = typeCfg(ticket.type.key);
  const states = t && cabStates(t);
  if (!states) return;
  if (to === states.awaiting && ticket.status !== states.awaiting && !ticket.riskLevel) {
    throw new ValidationError("Set a risk level before submitting this change for approval");
  }
  if (ticket.status === states.awaiting && to === states.approved && ticket.cabStatus === ApprovalStatus.PENDING) {
    const votes = await db.approval.findMany({ where: { ticketId: ticket.id, kind: ApprovalKind.CHANGE_CAB }, select: { status: true } });
    const pending = votes.filter((v) => v.status === ApprovalStatus.PENDING).length;
    if (pending > 0) {
      const approved = votes.filter((v) => v.status === ApprovalStatus.APPROVED).length;
      throw new ValidationError(`This change is waiting for the CAB (${approved} of ${Math.min(getConfig().itsm.cabQuorum, votes.length)} approvals so far)`);
    }
  }
}

/** CAB members from config, or everyone who can approve changes when none are listed. */
async function cabApprovers(excludeIds: (string | null)[]) {
  const cfg = getConfig();
  const select = { id: true, name: true, email: true, notifyByEmail: true } as const;
  let users = cfg.itsm.cabMembers.length
    ? await db.user.findMany({ where: { email: { in: cfg.itsm.cabMembers.map((e) => e.toLowerCase()) }, isActive: true }, select })
    : (
        await db.user.findMany({
          where: { isActive: true, roles: { some: { role: { OR: [{ permissions: { has: "change.approve" } }, { permissions: { has: WILDCARD } }] } } } },
          select,
        })
      );
  // People don't approve their own change, unless nobody else could.
  const others = users.filter((u) => !excludeIds.includes(u.id));
  if (others.length) users = others;
  return users;
}

async function onEnterAwaiting(event: TicketEvent, states: NonNullable<ReturnType<typeof cabStates>>) {
  const cfg = getConfig();
  const ticket = await db.ticket.findUniqueOrThrow({ where: { id: event.ticketId }, select: { id: true, number: true, title: true, riskLevel: true, requesterId: true, createdById: true, plannedStartAt: true, changePlan: true, assigneeId: true } });

  if (!cabRequired(cfg, ticket.riskLevel)) {
    await db.ticket.update({ where: { id: ticket.id }, data: { cabStatus: ApprovalStatus.NOT_REQUIRED } });
    const { transitionTicket } = await import("./tickets");
    await transitionTicket(systemActor("cab"), ticket.id, { to: states.approved, comment: `<p>${escapeHtml(riskName(ticket.riskLevel))}-risk change: approved without CAB review.</p>`, commentVisibility: CommentVisibility.INTERNAL }, { depth: event.depth, reason: "pre-approved" });
    return;
  }

  const approvers = await cabApprovers([event.actor.userId, ticket.createdById]);
  await db.ticket.update({ where: { id: ticket.id }, data: { cabStatus: approvers.length ? ApprovalStatus.PENDING : ApprovalStatus.NOT_REQUIRED } });
  if (!approvers.length) {
    await systemNote(ticket.id, "<p>No CAB members are configured, so a team lead or admin needs to approve this change by hand.</p>");
    await db.approval.updateMany({ where: { ticketId: ticket.id, kind: ApprovalKind.CHANGE_CAB, status: ApprovalStatus.PENDING }, data: { status: ApprovalStatus.NOT_REQUIRED } });
    return;
  }
  // Fresh round: resubmitting after a rejection resets earlier votes.
  await db.approval.updateMany({ where: { ticketId: ticket.id, kind: ApprovalKind.CHANGE_CAB }, data: { status: ApprovalStatus.NOT_REQUIRED } });
  for (const a of approvers) {
    await db.approval.upsert({
      where: { ticketId_approverId_kind: { ticketId: ticket.id, approverId: a.id, kind: ApprovalKind.CHANGE_CAB } },
      create: { ticketId: ticket.id, approverId: a.id, kind: ApprovalKind.CHANGE_CAB },
      update: { status: ApprovalStatus.PENDING, comment: null, decidedAt: null },
    });
  }
  const needed = Math.min(cfg.itsm.cabQuorum, approvers.length);
  await systemNote(ticket.id, `<p>Sent to the CAB (${approvers.map((a) => escapeHtml(a.name)).join(", ")}). Needs ${needed} approval${needed === 1 ? "" : "s"}; any rejection rejects the change.</p>`);
  await notifyUsers(approvers.map((a) => a.id), { type: "approval.requested", title: `CAB review: ${ticket.number}`, body: ticket.title, link: "/agent/approvals", ticketId: ticket.id }, null);
  for (const a of approvers.filter((x) => x.notifyByEmail)) {
    await queueEmail({
      kind: "approval.requested",
      to: a.email,
      subject: `CAB review needed: [${ticket.number}] ${ticket.title}`,
      ticket: { id: ticket.id, number: ticket.number },
      content: {
        heading: "A change needs your review",
        bodyHtml: ticket.changePlan ? richText(ticket.changePlan).html : undefined,
        facts: [["Change", `${ticket.number} · ${ticket.title}`], ["Risk", riskName(ticket.riskLevel)], ...(ticket.plannedStartAt ? [["Planned start", ticket.plannedStartAt.toISOString().replace("T", " ").slice(0, 16) + " UTC"] as [string, string]] : [])],
        button: { label: "Review change", url: appUrl("/agent/approvals") },
      },
    });
  }
}

function riskName(key: string | null): string {
  return getConfig().itsm.riskLevels.find((r) => r.key === key)?.name ?? key ?? "Unknown";
}

/** Called after each CAB vote. Moves the change on once the outcome is known. */
export async function settleCabApproval(ticketId: string): Promise<void> {
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, include: { type: true } });
  if (!ticket || ticket.cabStatus !== ApprovalStatus.PENDING) return;
  const t = typeCfg(ticket.type.key);
  const states = t && cabStates(t);
  if (!states) return;
  const votes = await db.approval.findMany({ where: { ticketId, kind: ApprovalKind.CHANGE_CAB }, include: { approver: { select: { name: true } } } });
  const outcome = cabOutcome(votes.map((v) => v.status), getConfig().itsm.cabQuorum);
  if (outcome === "PENDING") return;

  await db.ticket.update({ where: { id: ticketId }, data: { cabStatus: outcome } });
  await db.approval.updateMany({ where: { ticketId, kind: ApprovalKind.CHANGE_CAB, status: ApprovalStatus.PENDING }, data: { status: ApprovalStatus.NOT_REQUIRED } });
  if (ticket.status !== states.awaiting) return;

  const { transitionTicket } = await import("./tickets");
  const decided = votes.filter((v) => v.status === outcome);
  const summary = decided.map((v) => `${escapeHtml(v.approver.name)}${v.comment ? `: “${escapeHtml(v.comment)}”` : ""}`).join("<br>");
  const actor = systemActor("cab");
  if (outcome === "APPROVED") {
    await transitionTicket(actor, ticketId, { to: states.approved, comment: `<p>Approved by the CAB.</p><p>${summary}</p>`, commentVisibility: CommentVisibility.INTERNAL }, { reason: "CAB approved" });
  } else if (states.rejected) {
    await transitionTicket(actor, ticketId, { to: states.rejected, comment: `<p>Rejected by the CAB.</p><p>${summary}</p>`, commentVisibility: CommentVisibility.INTERNAL }, { reason: "CAB rejected" });
  } else {
    await systemNote(ticketId, `<p>Rejected by the CAB.</p><p>${summary}</p>`);
  }
}

onTicketEvent(async (event) => {
  if (event.type !== "ticket.status_changed" || !event.changes?.status) return;
  const { from, to } = event.changes.status as { from: string; to: string };
  const ticket = await db.ticket.findUnique({ where: { id: event.ticketId }, select: { cabStatus: true, type: { select: { key: true } } } });
  const t = ticket && typeCfg(ticket.type.key);
  const states = t && cabStates(t);
  if (!ticket || !states) return;
  try {
    if (to === states.awaiting && from !== states.awaiting) {
      await onEnterAwaiting(event, states);
    } else if (from === states.awaiting && ticket.cabStatus === ApprovalStatus.PENDING) {
      // Moved on without a CAB decision (rejected by a lead, an automation, no CAB members): close the open votes.
      await db.approval.updateMany({ where: { ticketId: event.ticketId, kind: ApprovalKind.CHANGE_CAB, status: ApprovalStatus.PENDING }, data: { status: ApprovalStatus.NOT_REQUIRED } });
      await db.ticket.update({ where: { id: event.ticketId }, data: { cabStatus: to === states.approved ? ApprovalStatus.APPROVED : to === states.rejected ? ApprovalStatus.REJECTED : ApprovalStatus.NOT_REQUIRED } });
    }
  } catch (err) {
    logger.error({ err, ticketId: event.ticketId }, "CAB processing failed");
  }
});

