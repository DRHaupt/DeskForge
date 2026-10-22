/**
 * Ticket domain events.
 *
 * Services call `emitTicketEvent` after a change is committed. Synchronous
 * in-process hooks run first (e.g. SLA timers must be updated before the
 * response returns), then the event is queued for asynchronous consumers
 * (notifications, automations, webhooks) in the worker.
 */
import type { Actor } from "@/core/rbac/actor";
import { actorLabel, actorUserId } from "@/core/rbac/actor";
import { logger } from "./logger";
import { enqueue, QUEUES } from "./queue";
import { setQueueing, sideEffectsEnabled } from "./side-effects";

export const TICKET_EVENTS = [
  "ticket.created",
  "ticket.updated",
  "ticket.status_changed",
  "ticket.assigned",
  "ticket.commented",
  "ticket.merged",
  "ticket.deleted",
  "sla.warning",
  "sla.breached",
] as const;
export type TicketEventType = (typeof TICKET_EVENTS)[number];

export type TicketEvent = {
  type: TicketEventType;
  ticketId: string;
  actor: { kind: Actor["kind"]; userId: string | null; label: string };
  /** Field → {from, to} for updates; status for transitions; commentId for comments. */
  changes?: Record<string, { from: unknown; to: unknown }>;
  commentId?: string;
  /** Prevents automation loops: depth of automation-triggered changes. */
  depth?: number;
  /** Comment posted as part of a status change (notifications are sent by the status change). */
  viaTransition?: boolean;
  at: string;
};

export type TicketHook = (event: TicketEvent) => Promise<void>;
const hooks: TicketHook[] = [];

/** Register an in-process hook (called synchronously after each change). */
export function onTicketEvent(hook: TicketHook) {
  hooks.push(hook);
}

/** Queueing follows the global side-effects switch (off in tests and while seeding). */
export function setEventQueueing(on: boolean) {
  setQueueing(on);
}

export async function emitTicketEvent(type: TicketEventType, ticketId: string, actor: Actor, extra: Partial<Pick<TicketEvent, "changes" | "commentId" | "depth" | "viaTransition">> = {}): Promise<TicketEvent> {
  const event: TicketEvent = {
    type,
    ticketId,
    actor: { kind: actor.kind, userId: actorUserId(actor), label: actorLabel(actor) },
    at: new Date().toISOString(),
    ...extra,
  };
  for (const hook of hooks) {
    try {
      await hook(event);
    } catch (err) {
      logger.error({ err, type, ticketId }, "ticket hook failed");
    }
  }
  if (sideEffectsEnabled()) await enqueue(QUEUES.events, type, event);
  return event;
}
