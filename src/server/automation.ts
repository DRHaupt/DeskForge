/**
 * Automation runner: evaluates rules for ticket events (worker) and on a
 * schedule, and executes actions through the normal ticket services as a
 * system actor — so workflow rules, validation and audit all still apply.
 *
 * Loop protection: actions carry `depth + 1`; events at MAX_AUTOMATION_DEPTH
 * don't run automations. Each automation runs at most once per event.
 */
import { z } from "zod";
import { getConfig } from "@/core/config/loader";
import {
  actionSchema,
  automationInputSchema,
  conditionsSchema,
  evaluateConditions,
  MAX_AUTOMATION_DEPTH,
  renderTemplate,
  scheduleMinutes,
  type AutomationAction,
  type Facts,
} from "@/core/automation/rules";
import { fromStorage } from "@/core/tickets/fields";
import type { FieldConfig } from "@/core/config/schema";
import { actorUserId, assertCan, systemActor, type Actor } from "@/core/rbac/actor";
import { NotFoundError, ValidationError } from "@/core/errors";
import type { Automation, Prisma } from "@/generated/prisma/client";
import { audit, type AuditContext } from "./audit";
import { db } from "./db";
import type { TicketEvent } from "./events";
import { logger } from "./logger";
import { queueEmail } from "./mail/outbound";
import { appUrl } from "./mail/templates";
import { plainTextToHtml } from "./richtext";
import { notifyUsers } from "./services/notifications";
import { addComment, assignTicket, getTicket, transitionTicket, updateTicket, updateWatchers } from "./services/tickets";
import { fanOutWebhooks } from "./webhooks";

const factsInclude = {
  type: { select: { key: true } },
  team: { select: { key: true, name: true } },
  assignee: { select: { name: true, email: true } },
  requester: { select: { name: true, email: true } },
  organization: { select: { slug: true, name: true } },
  category: { select: { path: true } },
  tags: { include: { tag: { select: { name: true } } } },
  fieldValues: { include: { fieldDef: true } },
  statusHistory: { orderBy: { createdAt: "desc" as const }, take: 1, select: { createdAt: true } },
} satisfies Prisma.TicketInclude;

type FactsTicket = Prisma.TicketGetPayload<{ include: typeof factsInclude }>;

const CHANGE_KEY: Record<string, string> = { teamId: "team", assigneeId: "assignee", categoryId: "category" };

export async function buildFacts(t: FactsTicket, event?: Pick<TicketEvent, "changes" | "commentId" | "type">, now = new Date()): Promise<Facts> {
  const hours = (d: Date) => Math.round(((now.getTime() - d.getTime()) / 3_600_000) * 100) / 100;
  const facts: Facts = {
    type: t.type.key,
    status: t.status,
    statusCategory: t.statusCategory.toLowerCase(),
    priority: t.priority,
    impact: t.impact,
    urgency: t.urgency,
    team: t.team?.key ?? null,
    assignee: t.assignee?.email ?? null,
    "requester.email": t.requester.email,
    "requester.domain": t.requester.email.split("@")[1] ?? "",
    organization: t.organization?.slug ?? null,
    category: t.category?.path ?? null,
    tags: t.tags.map((x) => x.tag.name),
    title: t.title,
    description: t.descriptionText,
    source: t.source.toLowerCase(),
    hoursSinceCreated: hours(t.createdAt),
    hoursSinceUpdated: hours(t.updatedAt),
    hoursInStatus: hours(t.statusHistory[0]?.createdAt ?? t.createdAt),
  };
  for (const fv of t.fieldValues) facts[`field.${fv.fieldDef.key}`] = fromStorage({ type: fv.fieldDef.fieldType.toLowerCase() as FieldConfig["type"] }, fv);
  if (event?.changes) {
    facts.changed = Object.fromEntries(Object.entries(event.changes).map(([k, v]) => [CHANGE_KEY[k] ?? k, v]));
    if (event.changes.teamId) {
      const [from, to] = await Promise.all(
        [event.changes.teamId.from, event.changes.teamId.to].map((id) => (id ? db.team.findUnique({ where: { id: String(id) }, select: { key: true } }).then((x) => x?.key ?? null) : null)),
      );
      facts.changed!.team = { from, to };
    }
  }
  if (event?.type.startsWith("sla.")) facts["sla.metric"] = String(event.changes?.metric?.to ?? "").toLowerCase();
  if (event?.commentId) {
    const c = await db.comment.findUnique({ where: { id: event.commentId }, select: { visibility: true, authorId: true, bodyText: true } });
    if (c) {
      facts["comment.visibility"] = c.visibility.toLowerCase();
      facts["comment.byRequester"] = c.authorId === t.requesterId;
      facts["comment.text"] = c.bodyText;
    }
  }
  return facts;
}

function templateVars(t: FactsTicket): Record<string, unknown> {
  return {
    "ticket.number": t.number,
    "ticket.title": t.title,
    "ticket.status": t.status,
    "ticket.priority": t.priority,
    "ticket.url": appUrl(`/agent/tickets/${t.number}`),
    "ticket.portal_url": appUrl(`/portal/tickets/${t.number}`),
    "requester.name": t.requester.name,
    "requester.first_name": t.requester.name.split(" ")[0],
    "requester.email": t.requester.email,
    "assignee.name": t.assignee?.name ?? "",
    "team.name": t.team?.name ?? "",
    "organization.name": t.organization?.name ?? "",
  };
}

async function resolveUser(ref: string) {
  if (ref === "unassigned") return null;
  return db.user.findFirst({ where: ref.includes("@") ? { email: ref.toLowerCase() } : { id: ref }, select: { id: true, name: true, email: true, notifyByEmail: true, isActive: true } });
}

async function executeAction(action: AutomationAction, ticketId: string, actor: Actor, depth: number, event: TicketEvent | null): Promise<string> {
  const opts = { depth };
  const t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: factsInclude });
  const vars = templateVars(t);
  switch (action.type) {
    case "set_priority":
      await updateTicket(actor, ticketId, { priority: action.value }, opts);
      return `priority → ${action.value}`;
    case "set_status": {
      if (t.status === action.value) return "status unchanged";
      await transitionTicket(actor, ticketId, { to: action.value, comment: action.comment ? plainTextToHtml(renderTemplate(action.comment, vars)) : undefined, commentVisibility: "PUBLIC" }, opts);
      return `status → ${action.value}`;
    }
    case "assign_team": {
      const team = await db.team.findFirst({ where: { OR: [{ key: action.team }, { id: action.team }], isActive: true } });
      if (!team) throw new ValidationError(`Unknown team "${action.team}"`);
      await assignTicket(actor, ticketId, { teamId: team.id, ...(action.keepAssignee ? { assigneeId: t.assigneeId } : {}) }, opts);
      return `team → ${team.key}`;
    }
    case "assign_user": {
      const user = await resolveUser(action.user);
      if (action.user !== "unassigned" && !user) throw new ValidationError(`Unknown user "${action.user}"`);
      await assignTicket(actor, ticketId, { assigneeId: user?.id ?? null }, opts);
      return `assignee → ${user?.email ?? "nobody"}`;
    }
    case "add_tag":
    case "remove_tag": {
      const tags = t.tags.map((x) => x.tag.name);
      const v = action.value.toLowerCase();
      const next = action.type === "add_tag" ? [...new Set([...tags, v])] : tags.filter((x) => x !== v);
      if (next.length === tags.length && next.every((x) => tags.includes(x))) return "tags unchanged";
      await updateTicket(actor, ticketId, { tags: next }, opts);
      return `${action.type === "add_tag" ? "+" : "-"}tag ${v}`;
    }
    case "set_field":
      await updateTicket(actor, ticketId, { fields: { [action.key]: action.value } }, opts);
      return `field ${action.key} set`;
    case "add_comment":
      await addComment(actor, ticketId, { body: plainTextToHtml(renderTemplate(action.body, vars)), visibility: action.visibility }, { depth, authorId: null });
      return `${action.visibility.toLowerCase()} comment added`;
    case "notify": {
      const userIds: string[] = [];
      const emails: string[] = [];
      for (const to of action.to) {
        if (to === "assignee" && t.assigneeId) userIds.push(t.assigneeId);
        else if (to === "requester") userIds.push(t.requesterId);
        else if ((to === "team" || to === "team_leads") && t.teamId) {
          const members = await db.teamMember.findMany({ where: { teamId: t.teamId, ...(to === "team_leads" ? { isLead: true } : {}) }, select: { userId: true } });
          userIds.push(...members.map((m) => m.userId));
        } else if (to.includes("@")) emails.push(to.toLowerCase());
      }
      const message = renderTemplate(action.message, vars);
      const subject = renderTemplate(action.subject ?? `[{{ticket.number}}] {{ticket.title}}`, vars);
      const staffIds = userIds.filter((u) => u !== t.requesterId);
      await notifyUsers(staffIds, { type: "automation", title: subject, body: message.slice(0, 200), link: `/agent/tickets/${t.number}`, ticketId }, null);
      const users = await db.user.findMany({ where: { id: { in: userIds }, isActive: true, notifyByEmail: true }, select: { id: true, email: true } });
      for (const to of new Set([...users.map((u) => u.email), ...emails])) {
        const isRequester = to === t.requester.email;
        await queueEmail({
          kind: "automation",
          to,
          subject,
          ticket: { id: t.id, number: t.number },
          content: { heading: subject, paragraphs: message.split(/\n{2,}/), button: { label: "View ticket", url: isRequester ? (vars["ticket.portal_url"] as string) : (vars["ticket.url"] as string) }, replyable: isRequester },
        });
      }
      return `notified ${userIds.length + emails.length}`;
    }
    case "add_watcher":
      await updateWatchers(actor, ticketId, { add: [], remove: [], addEmails: [action.email], removeEmails: [] });
      return `watcher ${action.email}`;
    case "webhook": {
      const ev: TicketEvent = event ?? { type: "ticket.updated", ticketId, actor: { kind: "system", userId: null, label: "automation" }, at: new Date().toISOString() };
      const n = await fanOutWebhooks(ev, action.webhookId);
      if (!n) throw new ValidationError("Webhook not found or inactive");
      return "webhook queued";
    }
  }
}

async function runOne(automation: Automation, ticketId: string, event: TicketEvent | null, facts: Facts): Promise<boolean> {
  const conditions = conditionsSchema.safeParse(automation.conditions);
  const actions = z.array(actionSchema).safeParse(automation.actions);
  if (!conditions.success || !actions.success) {
    logger.warn({ automation: automation.id }, "automation has invalid rules; skipping");
    return false;
  }
  if (!evaluateConditions(conditions.data, facts)) return false;
  const actor = systemActor(`automation:${automation.name}`);
  const depth = (event?.depth ?? 0) + 1;
  const done: string[] = [];
  let error: string | null = null;
  for (const action of actions.data) {
    try {
      done.push(await executeAction(action, ticketId, actor, depth, event));
    } catch (err) {
      error = `${action.type}: ${(err as Error).message}`;
      logger.warn({ automation: automation.name, ticketId, err: error }, "automation action failed");
      break;
    }
  }
  await db.automationRun.create({ data: { automationId: automation.id, ticketId, event: event?.type ?? "schedule", matched: true, success: !error, error, actionsRun: done } });
  await db.automation.update({ where: { id: automation.id }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } });
  return true;
}

/** Called by the worker for every ticket event. */
export async function runAutomationsForEvent(event: TicketEvent): Promise<number> {
  if ((event.depth ?? 0) >= MAX_AUTOMATION_DEPTH) return 0;
  const automations = await db.automation.findMany({ where: { isActive: true, trigger: event.type }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  if (!automations.length) return 0;
  let ran = 0;
  for (const a of automations) {
    // Re-read facts each time: earlier automations may have changed the ticket.
    const t = await db.ticket.findUnique({ where: { id: event.ticketId }, include: factsInclude });
    if (!t || t.deletedAt) return ran;
    const facts = await buildFacts(t, event);
    if (await runOne(a, t.id, event, facts)) {
      ran++;
      if (a.stopProcessing) break;
    }
  }
  return ran;
}

/**
 * Scheduled automations (time-based rules like "close tickets waiting on the
 * customer for 3 days"). Each rule runs at its own interval and acts on a
 * ticket at most once until that ticket changes again.
 */
export async function runScheduledAutomations(now = new Date()): Promise<{ automation: string; matched: number }[]> {
  const automations = await db.automation.findMany({ where: { isActive: true, trigger: "schedule" }, orderBy: { order: "asc" } });
  const out: { automation: string; matched: number }[] = [];
  for (const a of automations) {
    if (a.lastRunAt && now.getTime() - a.lastRunAt.getTime() < scheduleMinutes(a.schedule) * 60_000 - 5_000) continue;
    const candidates = await db.ticket.findMany({
      where: { deletedAt: null, mergedIntoId: null, updatedAt: { gte: new Date(now.getTime() - 180 * 86_400_000) } },
      include: { ...factsInclude, automationRuns: { where: { automationId: a.id }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } },
      orderBy: { updatedAt: "asc" },
      take: 1000,
    });
    let matched = 0;
    for (const t of candidates) {
      const lastRun = t.automationRuns[0]?.createdAt;
      if (lastRun && lastRun >= t.updatedAt) continue;
      if (await runOne(a, t.id, null, await buildFacts(t, undefined, now))) matched++;
    }
    await db.automation.update({ where: { id: a.id }, data: { lastRunAt: now } });
    out.push({ automation: a.name, matched });
  }
  return out;
}

// ─── Management API ────────────────────────────────────────────────────────

function validateRefs(input: Partial<z.infer<typeof automationInputSchema>>) {
  const cfg = getConfig();
  for (const a of input.actions ?? []) {
    if (a.type === "set_priority" && !cfg.priorities.levels.some((p) => p.key === a.value)) throw new ValidationError(`Unknown priority "${a.value}"`);
    if (a.type === "set_status" && !cfg.ticketTypes.some((t) => t.workflow.states.some((s) => s.key === a.value))) throw new ValidationError(`Unknown status "${a.value}"`);
  }
  if (input.trigger === "schedule" && !input.schedule) throw new ValidationError('Scheduled automations need a schedule like "every 15m"');
}

export async function listAutomations(actor: Actor) {
  assertCan(actor, "automation.manage");
  return db.automation.findMany({ orderBy: [{ trigger: "asc" }, { order: "asc" }], include: { createdBy: { select: { name: true } }, runs: { orderBy: { createdAt: "desc" }, take: 5 } } });
}

export async function createAutomation(actor: Actor, raw: z.input<typeof automationInputSchema>, ctx?: AuditContext) {
  assertCan(actor, "automation.manage");
  const input = automationInputSchema.parse(raw);
  validateRefs(input);
  const a = await db.automation.create({ data: { ...input, conditions: input.conditions, actions: input.actions as object[], createdById: actorUserId(actor) } });
  await audit(actor, { action: "automation.create", entityType: "automation", entityId: a.id, changes: input }, ctx);
  return { id: a.id };
}

export async function updateAutomation(actor: Actor, id: string, raw: Partial<z.input<typeof automationInputSchema>>, ctx?: AuditContext) {
  assertCan(actor, "automation.manage");
  const input = automationInputSchema.partial().parse(raw);
  validateRefs(input);
  await db.automation.update({ where: { id }, data: { ...input, ...(input.actions ? { actions: input.actions as object[] } : {}) } });
  await audit(actor, { action: "automation.update", entityType: "automation", entityId: id, changes: input }, ctx);
  return { id };
}

export async function deleteAutomation(actor: Actor, id: string, ctx?: AuditContext) {
  assertCan(actor, "automation.manage");
  await db.automation.delete({ where: { id } });
  await audit(actor, { action: "automation.delete", entityType: "automation", entityId: id }, ctx);
  return { id };
}

/** Dry run against a ticket: which conditions match, without executing actions. */
export async function testAutomation(actor: Actor, raw: z.input<typeof automationInputSchema>, ticketRef: string) {
  assertCan(actor, "automation.manage");
  const input = automationInputSchema.parse(raw);
  const ticket = await getTicket(actor, ticketRef);
  const t = await db.ticket.findUnique({ where: { id: ticket.id }, include: factsInclude });
  if (!t) throw new NotFoundError("Ticket");
  const facts = await buildFacts(t);
  const { evaluateCondition } = await import("@/core/automation/rules");
  return {
    matches: evaluateConditions(input.conditions, facts),
    all: input.conditions.all.map((c) => ({ ...c, actual: facts[c.field] ?? null, result: evaluateCondition(c, facts) })),
    any: input.conditions.any.map((c) => ({ ...c, actual: facts[c.field] ?? null, result: evaluateCondition(c, facts) })),
    facts: Object.fromEntries(Object.entries(facts).filter(([k]) => k !== "description")),
  };
}

