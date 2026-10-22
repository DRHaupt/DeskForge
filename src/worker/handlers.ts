/** Job name → handler. Each module registers its handlers here. */
import type { Job } from "bullmq";
import { db } from "../server/db";
import { getRedis } from "../server/redis";
import { TICKET_EVENTS, type TicketEvent } from "../server/events";
import { sendOutbound } from "../server/mail/outbound";
import { pollMailboxes } from "../server/mail/imap";
import { sweepSla } from "../server/sla";
import { notifyForEvent } from "../server/services/notifications";
import { sendCsat } from "../server/services/csat";
import { runAutomationsForEvent, runScheduledAutomations } from "../server/automation";
import { deliverWebhook, fanOutWebhooks } from "../server/webhooks";
import { logger } from "../server/logger";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- job payloads are validated inside each handler
export type JobHandler = (data: any, job: Job) => Promise<unknown>;

/** Everything that reacts to a ticket event, in order. Later modules add automations and webhooks. */
export async function handleTicketEvent(event: TicketEvent) {
  // Each consumer is isolated: a failing webhook must not stop notifications.
  for (const [name, fn] of [
    ["notifications", notifyForEvent],
    ["automations", runAutomationsForEvent],
    ["webhooks", fanOutWebhooks],
  ] as const) {
    try {
      await fn(event);
    } catch (err) {
      logger.error({ err, consumer: name, event: event.type, ticketId: event.ticketId }, "event consumer failed");
    }
  }
}

export const handlers: Record<string, JobHandler> = {
  /** Records that the worker is alive (shown on the admin health page). */
  heartbeat: async () => {
    await getRedis().set("deskforge:worker:heartbeat", new Date().toISOString(), "EX", 300);
    await db.$queryRaw`SELECT 1`;
    return { ok: true };
  },
  "sla-sweep": async () => sweepSla(),
  "imap-poll": async () => pollMailboxes(),
  "send-email": async (data: { id: string }) => sendOutbound(data.id),
  "send-csat": async (data: { id: string }) => sendCsat(data.id),
  "deliver-webhook": async (data: { id: string }) => deliverWebhook(data.id),
  "automation-schedule": async () => runScheduledAutomations(),
  ...Object.fromEntries(TICKET_EVENTS.map((name) => [name, (event: TicketEvent) => handleTicketEvent(event)])),
};
