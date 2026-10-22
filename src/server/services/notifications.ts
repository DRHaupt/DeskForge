/**
 * Notification fan-out: turns ticket events into in-app notifications and
 * branded emails. Runs in the worker (events queue). Nobody is ever notified
 * about their own action.
 */
import { z } from "zod";
import { getConfig } from "@/core/config/loader";
import { getTicketTypeConfig } from "@/core/config/helpers";
import { actorUserId, type Actor } from "@/core/rbac/actor";
import { expandPermissions } from "@/core/rbac/roles";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import type { TicketEvent } from "../events";
import { appUrl } from "../mail/templates";
import { queueEmail } from "../mail/outbound";
import { excerpt } from "../richtext";

const ticketInclude = {
  type: true,
  requester: { select: { id: true, name: true, email: true, isActive: true, notifyByEmail: true } },
  assignee: { select: { id: true, name: true, email: true, isActive: true, notifyByEmail: true } },
  team: { include: { members: { include: { user: { select: { id: true, name: true, email: true, isActive: true, notifyByEmail: true } } } } } },
  watchers: { include: { user: { select: { id: true, name: true, email: true, isActive: true, notifyByEmail: true, roles: { select: { role: { select: { permissions: true } } } } } } } },
} satisfies Prisma.TicketInclude;

type FullTicket = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;
type Person = { id: string; name: string; email: string; isActive: boolean; notifyByEmail: boolean };

function isStaffUser(u: { roles: { role: { permissions: string[] } }[] }) {
  const p = expandPermissions(u.roles.flatMap((r) => r.role.permissions));
  return p.has("ticket.view_team") || p.has("ticket.view_all");
}

const agentLink = (t: { number: string }) => appUrl(`/agent/tickets/${t.number}`);
const portalLink = (t: { number: string }) => appUrl(`/portal/tickets/${t.number}`);

function statusName(t: FullTicket, key: string, portal = false) {
  const s = getTicketTypeConfig(getConfig(), t.type.key)?.workflow.states.find((x) => x.key === key);
  return (portal ? s?.portalName : undefined) ?? s?.name ?? key;
}

/** Create in-app notifications (deduplicated, excluding the actor). */
export async function notifyUsers(userIds: (string | null | undefined)[], data: { type: string; title: string; body?: string; link?: string; ticketId?: string }, exclude: string | null) {
  const ids = [...new Set(userIds.filter((u): u is string => Boolean(u) && u !== exclude))];
  if (!ids.length) return 0;
  const active = await db.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } });
  await db.notification.createMany({ data: active.map((u) => ({ userId: u.id, ...data })) });
  return active.length;
}

async function emailStaff(people: (Person | null | undefined)[], exclude: string | null, build: (p: Person) => Parameters<typeof queueEmail>[0]) {
  const seen = new Set<string>();
  for (const p of people) {
    if (!p || p.id === exclude || !p.isActive || !p.notifyByEmail || seen.has(p.id)) continue;
    seen.add(p.id);
    await queueEmail(build(p));
  }
}

function staffAudience(t: FullTicket): Person[] {
  const watchers = t.watchers.flatMap((w) => (w.user && isStaffUser(w.user) ? [w.user] : []));
  if (t.assignee) return [t.assignee, ...watchers];
  // Unassigned: the whole team hears about it.
  return [...(t.team?.members.map((m) => m.user) ?? []), ...watchers];
}

/** Customer side: requester + non-staff watchers + CC emails. */
function customerRecipients(t: FullTicket): { to: Person | null; cc: string[] } {
  const cc = t.watchers.flatMap((w) => (w.email ? [w.email] : w.user && !isStaffUser(w.user) && w.user.isActive && w.user.notifyByEmail ? [w.user.email] : []));
  return { to: t.requester.isActive && t.requester.notifyByEmail ? t.requester : null, cc };
}

export async function notifyForEvent(event: TicketEvent): Promise<void> {
  const t = await db.ticket.findUnique({ where: { id: event.ticketId }, include: ticketInclude });
  if (!t || t.deletedAt) return;
  const actorId = event.actor.userId;
  const actorName = event.actor.kind === "system" ? "Automation" : event.actor.label.includes("@") ? ((await db.user.findUnique({ where: { id: actorId ?? "" }, select: { name: true } }))?.name ?? event.actor.label) : event.actor.label;
  const subject = (prefix = "") => `${prefix}[${t.number}] ${t.title}`;
  const ticketRef = { id: t.id, number: t.number };
  const cfg = getConfig();

  switch (event.type) {
    case "ticket.created": {
      // Acknowledge to the requester, unless an agent logged it for themselves.
      const { to, cc } = customerRecipients(t);
      if (to && (to.id !== actorId || t.source !== "AGENT")) {
        await queueEmail({
          kind: "ticket.created.ack",
          to: to.email,
          cc,
          subject: subject(),
          ticket: ticketRef,
          content: {
            heading: `We've received your request ${t.number}`,
            paragraphs: [`Hi ${to.name.split(" ")[0]}, thanks for getting in touch. We'll reply as soon as we can — you can reply to this email to add more information.`],
            facts: [["Ticket", t.number], ["Subject", t.title]],
            button: { label: "View your request", url: portalLink(t) },
            replyable: true,
          },
        });
      }
      if (!t.assigneeId && t.team) {
        await notifyUsers(t.team.members.map((m) => m.userId), { type: "ticket.new", title: `New in ${t.team.name}: ${t.number}`, body: t.title, link: `/agent/tickets/${t.number}`, ticketId: t.id }, actorId);
      }
      return;
    }

    case "ticket.assigned": {
      const to = event.changes?.assigneeId?.to as string | null | undefined;
      if (to && to !== actorId && t.assignee) {
        await notifyUsers([to], { type: "ticket.assigned", title: `${t.number} assigned to you`, body: t.title, link: `/agent/tickets/${t.number}`, ticketId: t.id }, actorId);
        await emailStaff([t.assignee], actorId, (p) => ({
          kind: "ticket.assigned",
          to: p.email,
          subject: subject("Assigned: "),
          ticket: ticketRef,
          content: { heading: `${actorName} assigned ${t.number} to you`, paragraphs: [t.title, excerpt(t.descriptionText, 400)], button: { label: "Open ticket", url: agentLink(t) } },
        }));
      } else if (!to && event.changes?.teamId && t.team) {
        await notifyUsers(t.team.members.map((m) => m.userId), { type: "ticket.new", title: `${t.number} moved to ${t.team.name}`, body: t.title, link: `/agent/tickets/${t.number}`, ticketId: t.id }, actorId);
      }
      return;
    }

    case "ticket.commented": {
      if (!event.commentId) return;
      const c = await db.comment.findUnique({ where: { id: event.commentId }, include: { author: { select: { id: true, name: true, roles: { select: { role: { select: { permissions: true } } } } } } } });
      if (!c || c.deletedAt) return;
      const authorIsStaff = c.author ? isStaffUser(c.author) : event.actor.kind === "system";
      const authorName = c.author?.name ?? actorName;

      // Mentions: always in-app, plus email.
      if (c.mentions.length) {
        await notifyUsers(c.mentions, { type: "mention", title: `${authorName} mentioned you on ${t.number}`, body: excerpt(c.bodyText, 140), link: `/agent/tickets/${t.number}`, ticketId: t.id }, c.authorId);
        const mentioned = await db.user.findMany({ where: { id: { in: c.mentions } }, select: { id: true, name: true, email: true, isActive: true, notifyByEmail: true } });
        await emailStaff(mentioned, c.authorId, (p) => ({
          kind: "mention",
          to: p.email,
          subject: subject("Mentioned: "),
          ticket: ticketRef,
          content: { heading: `${authorName} mentioned you on ${t.number}`, bodyHtml: c.body, button: { label: "Open ticket", url: agentLink(t) } },
        }));
      }

      if (c.visibility === "INTERNAL") {
        await notifyUsers(staffAudience(t).map((p) => p.id).filter((id) => !c.mentions.includes(id)), { type: "ticket.note", title: `Internal note on ${t.number}`, body: excerpt(c.bodyText, 140), link: `/agent/tickets/${t.number}`, ticketId: t.id }, c.authorId);
        return;
      }

      if (authorIsStaff) {
        // Staff public reply → customer side by email (status-change replies are sent by the status handler).
        if (!event.viaTransition && !c.isSystem) {
          const { to, cc } = customerRecipients(t);
          if (to && to.id !== c.authorId) {
            await queueEmail({
              kind: "ticket.reply",
              to: to.email,
              cc,
              subject: subject("Re: "),
              ticket: ticketRef,
              content: { heading: `${authorName} replied to your request`, bodyHtml: c.body, facts: [["Ticket", t.number], ["Status", statusName(t, t.status, true)]], button: { label: "View conversation", url: portalLink(t) }, replyable: true },
            });
          }
        }
        await notifyUsers(staffAudience(t).map((p) => p.id), { type: "ticket.reply", title: `${authorName} replied on ${t.number}`, body: excerpt(c.bodyText, 140), link: `/agent/tickets/${t.number}`, ticketId: t.id }, c.authorId);
        return;
      }

      // Customer replied → assignee/team + staff watchers.
      const audience = staffAudience(t);
      await notifyUsers(audience.map((p) => p.id), { type: "ticket.customer_reply", title: `${authorName} replied on ${t.number}`, body: excerpt(c.bodyText, 140), link: `/agent/tickets/${t.number}`, ticketId: t.id }, c.authorId);
      await emailStaff(t.assignee ? [t.assignee] : audience, c.authorId, (p) => ({
        kind: "ticket.customer_reply",
        to: p.email,
        subject: subject("Re: "),
        ticket: ticketRef,
        content: { heading: `${authorName} replied on ${t.number}`, bodyHtml: c.body, button: { label: "Open ticket", url: agentLink(t) }, replyable: true },
      }));
      return;
    }

    case "ticket.status_changed": {
      const to = event.changes?.status?.to as string;
      const category = String(event.changes?.statusCategory?.to ?? "").toLowerCase();
      const comment = event.commentId ? await db.comment.findUnique({ where: { id: event.commentId } }) : null;
      const publicComment = comment && comment.visibility === "PUBLIC" ? comment : null;
      const { to: requester, cc } = customerRecipients(t);
      const actorIsRequester = actorId === t.requesterId;

      if (requester && !actorIsRequester && (category === "resolved" || category === "closed" || publicComment)) {
        const resolved = category === "resolved";
        const closed = category === "closed";
        await queueEmail({
          kind: resolved ? "ticket.resolved" : closed ? "ticket.closed" : "ticket.status",
          to: requester.email,
          cc,
          subject: subject(resolved ? "Resolved: " : "Re: "),
          ticket: ticketRef,
          content: {
            heading: resolved ? `Your request ${t.number} has been resolved` : closed ? `Your request ${t.number} is closed` : `${actorName} updated your request`,
            bodyHtml: publicComment?.body,
            paragraphs: resolved && cfg.portal.reopenOnReply ? ["If this didn't fix things, just reply to this email and we'll pick it back up."] : [],
            facts: [["Ticket", t.number], ["Status", statusName(t, to, true)]],
            button: { label: "View request", url: portalLink(t) },
            replyable: true,
          },
        });
      }
      // Staff: tell the assignee when someone else (incl. the requester) changes status.
      if (t.assigneeId && t.assigneeId !== actorId) {
        await notifyUsers([t.assigneeId], { type: "ticket.status", title: `${t.number} is now ${statusName(t, to)}`, body: `${actorName} changed the status`, link: `/agent/tickets/${t.number}`, ticketId: t.id }, actorId);
      }
      return;
    }

    case "ticket.merged": {
      const into = event.changes?.mergedInto?.to as string | undefined;
      const target = into ? await db.ticket.findUnique({ where: { id: into }, select: { number: true } }) : null;
      const { to, cc } = customerRecipients(t);
      if (to && target) {
        await queueEmail({
          kind: "ticket.merged",
          to: to.email,
          cc,
          subject: subject(),
          ticket: ticketRef,
          content: { heading: `${t.number} was merged into ${target.number}`, paragraphs: ["We're tracking your request together with a related one. Further updates will come from the other ticket."], button: { label: `View ${target.number}`, url: portalLink(target) } },
        });
      }
      return;
    }

    case "sla.warning":
    case "sla.breached": {
      const metric = event.changes?.metric?.to === "FIRST_RESPONSE" ? "first response" : "resolution";
      const breach = event.type === "sla.breached";
      const esc = cfg.sla.escalation;
      if (breach ? !esc.notifyOnBreach : !esc.notifyOnWarning) return;
      const leads = t.team?.members.filter((m) => m.isLead).map((m) => m.user) ?? [];
      const escalationUser = breach && t.team?.escalationUserId ? await db.user.findUnique({ where: { id: t.team.escalationUserId }, select: { id: true, name: true, email: true, isActive: true, notifyByEmail: true } }) : null;
      const people: Person[] = [...(t.assignee ? [t.assignee] : t.team?.members.map((m) => m.user) ?? []), ...leads, ...(escalationUser ? [escalationUser] : [])];
      const title = breach ? `SLA breached: ${t.number} missed its ${metric} target` : `SLA warning: ${t.number} ${metric} due soon`;
      await notifyUsers(people.map((p) => p.id), { type: event.type, title, body: t.title, link: `/agent/tickets/${t.number}`, ticketId: t.id }, null);
      await emailStaff(people, null, (p) => ({
        kind: event.type,
        to: p.email,
        subject: subject(breach ? "SLA breached: " : "SLA warning: "),
        ticket: ticketRef,
        content: { heading: title, paragraphs: [t.title], facts: [["Priority", t.priority], ["Assignee", t.assignee?.name ?? "Unassigned"], ["Team", t.team?.name ?? "—"]], button: { label: "Open ticket", url: agentLink(t) } },
      }));
      return;
    }

    default:
      return;
  }
}

// ─── In-app notification API ───────────────────────────────────────────────

export async function listNotifications(actor: Actor, opts: { unreadOnly?: boolean; limit?: number }) {
  const uid = actorUserId(actor);
  if (!uid) return { unread: 0, items: [] };
  const [unread, items] = await Promise.all([
    db.notification.count({ where: { userId: uid, readAt: null } }),
    db.notification.findMany({ where: { userId: uid, ...(opts.unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: opts.limit ?? 30 }),
  ]);
  return { unread, items };
}

export const markReadSchema = z.object({ ids: z.array(z.string().max(64)).max(200).optional(), all: z.boolean().optional() });

export async function markRead(actor: Actor, input: z.infer<typeof markReadSchema>) {
  const uid = actorUserId(actor);
  if (!uid) return { updated: 0 };
  const res = await db.notification.updateMany({ where: { userId: uid, readAt: null, ...(input.all ? {} : { id: { in: input.ids ?? [] } }) }, data: { readAt: new Date() } });
  return { updated: res.count };
}
