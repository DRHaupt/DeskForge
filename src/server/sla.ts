/**
 * SLA persistence: reconcile timers after every ticket change (synchronous
 * hook) and sweep for warnings/breaches (worker, every minute).
 */
import { getConfig } from "@/core/config/loader";
import { getTicketTypeConfig, raisePriority } from "@/core/config/helpers";
import { calendarFromConfig } from "@/core/sla/calendar";
import { reconcileTimer, selectPolicy, type Metric, type SlaPolicyLite, type Timer } from "@/core/sla/engine";
import { systemActor } from "@/core/rbac/actor";
import { ForbiddenError, NotFoundError, ValidationError } from "@/core/errors";
import { assertCan, type Actor } from "@/core/rbac/actor";
import type { SLAInstance, SLAPolicy } from "@/generated/prisma/client";
import { audit, type AuditContext } from "./audit";
import { db } from "./db";
import { emitTicketEvent, onTicketEvent } from "./events";
import { logger } from "./logger";
import { getTicket } from "./services/tickets";

const METRICS: Metric[] = ["FIRST_RESPONSE", "RESOLUTION"];

function toLite(p: SLAPolicy): SlaPolicyLite {
  return { ...p, calendar: p.calendar };
}

function toTimer(i: SLAInstance): Timer {
  return {
    metric: i.metric,
    status: i.status,
    targetMins: i.targetMins,
    startedAt: i.startedAt,
    dueAt: i.dueAt,
    warnAt: i.warnAt,
    pausedAt: i.pausedAt,
    elapsedMins: i.elapsedMins,
    stoppedAt: i.stoppedAt,
    breachedAt: i.breachedAt,
    warnedAt: i.warnedAt,
    overridden: Boolean(i.overriddenById),
  };
}

function sameTimer(a: Timer, b: Timer) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Bring a ticket's SLA timers in line with its current state. Idempotent. */
export async function reconcileTicketSla(ticketId: string, now = new Date()): Promise<void> {
  const cfg = getConfig();
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, include: { type: true, slaInstances: true } });
  if (!ticket) return;
  const typeCfg = getTicketTypeConfig(cfg, ticket.type.key);
  const state = typeCfg?.workflow.states.find((s) => s.key === ticket.status);
  const policies = cfg.sla.enabled ? await db.sLAPolicy.findMany({ where: { isActive: true } }) : [];
  const policy = ticket.deletedAt || ticket.mergedIntoId ? null : selectPolicy(policies, { priority: ticket.priority, typeKey: ticket.type.key });
  const cal = calendarFromConfig(cfg, policy?.calendar === "ALWAYS");
  const facts = {
    createdAt: ticket.createdAt,
    priority: ticket.priority,
    typeKey: ticket.type.key,
    status: ticket.status,
    category: ticket.statusCategory.toLowerCase(),
    statePausesSla: state?.pausesSla ?? false,
    firstRespondedAt: ticket.firstRespondedAt,
    resolvedAt: ticket.resolvedAt,
  };

  for (const metric of METRICS) {
    const existing = ticket.slaInstances.find((i) => i.metric === metric) ?? null;
    const prev = existing ? toTimer(existing) : null;
    const next = reconcileTimer(metric, prev, policy ? toLite(policy) : null, facts, now, cal);
    if (!next) continue;
    if (prev && sameTimer(prev, next) && existing!.policyId === (policy?.id ?? existing!.policyId)) continue;
    const data = {
      status: next.status,
      targetMins: next.targetMins,
      startedAt: next.startedAt,
      dueAt: next.dueAt,
      warnAt: next.warnAt,
      pausedAt: next.pausedAt,
      elapsedMins: Math.round(next.elapsedMins),
      stoppedAt: next.stoppedAt,
      breachedAt: next.breachedAt,
      warnedAt: next.warnedAt,
    };
    if (existing) {
      await db.sLAInstance.update({ where: { id: existing.id }, data: { ...data, policyId: policy?.id ?? existing.policyId } });
    } else if (policy) {
      await db.sLAInstance.create({ data: { ...data, ticketId, policyId: policy.id, metric } });
    }
  }
}

// Keep timers in sync after every ticket change, whatever the entry point.
let hookRegistered = false;
export function registerSlaHook() {
  if (hookRegistered) return;
  hookRegistered = true;
  onTicketEvent(async (event) => {
    if (event.type.startsWith("sla.")) return;
    await reconcileTicketSla(event.ticketId);
  });
}
registerSlaHook();

/**
 * Worker sweep: mark warnings and breaches whose time has come and emit events.
 * Returns counts for logging/tests.
 */
export async function sweepSla(now = new Date()): Promise<{ warned: number; breached: number }> {
  const cfg = getConfig();
  if (!cfg.sla.enabled) return { warned: 0, breached: 0 };
  let warned = 0;
  let breached = 0;
  const system = systemActor("sla");

  const due = await db.sLAInstance.findMany({ where: { status: "RUNNING", breachedAt: null, dueAt: { lte: now } }, take: 500 });
  for (const inst of due) {
    // Guard against double-processing by concurrent workers.
    const res = await db.sLAInstance.updateMany({ where: { id: inst.id, breachedAt: null }, data: { breachedAt: now, warnedAt: inst.warnedAt ?? now } });
    if (!res.count) continue;
    breached++;
    await emitTicketEvent("sla.breached", inst.ticketId, system, { changes: { metric: { from: null, to: inst.metric } } });
    await escalateOnBreach(inst.ticketId);
  }

  const warn = await db.sLAInstance.findMany({ where: { status: "RUNNING", warnedAt: null, warnAt: { lte: now }, breachedAt: null }, take: 500 });
  for (const inst of warn) {
    const res = await db.sLAInstance.updateMany({ where: { id: inst.id, warnedAt: null }, data: { warnedAt: now } });
    if (!res.count) continue;
    warned++;
    await emitTicketEvent("sla.warning", inst.ticketId, system, { changes: { metric: { from: null, to: inst.metric } } });
  }
  if (warned || breached) logger.info({ warned, breached }, "SLA sweep");
  return { warned, breached };
}

/** Escalation rules from config.sla.escalation, applied once per breach. */
async function escalateOnBreach(ticketId: string) {
  const cfg = getConfig();
  const esc = cfg.sla.escalation;
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, include: { team: true } });
  if (!ticket || ticket.statusCategory === "RESOLVED" || ticket.statusCategory === "CLOSED") return;
  const system = systemActor("sla-escalation");
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (esc.raisePriorityOnBreach) {
    const higher = raisePriority(cfg, ticket.priority);
    if (higher !== ticket.priority) {
      await db.ticket.update({ where: { id: ticketId }, data: { priority: higher } });
      changes.priority = { from: ticket.priority, to: higher };
    }
  }
  if (esc.reassignOnBreach && ticket.team?.escalationTeamId) {
    await db.ticket.update({ where: { id: ticketId }, data: { teamId: ticket.team.escalationTeamId, assigneeId: ticket.team.escalationUserId ?? null } });
    changes.teamId = { from: ticket.teamId, to: ticket.team.escalationTeamId };
    changes.assigneeId = { from: ticket.assigneeId, to: ticket.team.escalationUserId ?? null };
  } else if (esc.reassignOnBreach && ticket.team?.escalationUserId) {
    await db.ticket.update({ where: { id: ticketId }, data: { assigneeId: ticket.team.escalationUserId } });
    changes.assigneeId = { from: ticket.assigneeId, to: ticket.team.escalationUserId };
  }
  if (Object.keys(changes).length) {
    await audit(system, { action: changes.teamId || changes.assigneeId ? "ticket.assign" : "ticket.update", entityType: "ticket", entityId: ticketId, changes: { ...changes, reason: "SLA breach escalation" } });
    if (changes.priority) await emitTicketEvent("ticket.updated", ticketId, system, { changes: { priority: changes.priority } });
    if (changes.teamId || changes.assigneeId) await emitTicketEvent("ticket.assigned", ticketId, system, { changes });
  }
}

/** Team lead override of an SLA due date. */
export async function overrideSla(actor: Actor, ticketId: string, input: { metric: Metric; dueAt: string; reason: string }, ctx?: AuditContext) {
  assertCan(actor, "sla.override");
  const ticket = await getTicket(actor, ticketId);
  const inst = await db.sLAInstance.findUnique({ where: { ticketId_metric: { ticketId: ticket.id, metric: input.metric } } });
  if (!inst) throw new NotFoundError("SLA timer");
  if (inst.status !== "RUNNING" && inst.status !== "PAUSED") throw new ValidationError("Only running or paused timers can be overridden");
  const dueAt = new Date(input.dueAt);
  if (Number.isNaN(dueAt.getTime())) throw new ValidationError("Invalid due date");
  if (actor.kind !== "user" && actor.kind !== "api_key") throw new ForbiddenError("sla.override");
  const userId = actor.kind === "user" ? actor.id : actor.userId;
  await db.sLAInstance.update({
    where: { id: inst.id },
    data: { dueAt, warnAt: null, breachedAt: dueAt > new Date() ? null : inst.breachedAt, overriddenById: userId, overrideReason: input.reason },
  });
  await audit(actor, { action: "sla.override", entityType: "ticket", entityId: ticket.id, changes: { metric: input.metric, dueAt: { from: inst.dueAt, to: dueAt }, reason: input.reason } }, ctx);
  return { id: inst.id };
}
