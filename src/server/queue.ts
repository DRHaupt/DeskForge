/**
 * BullMQ queues. The app enqueues; the worker process (src/worker) consumes.
 * Queue names are stable — renaming one orphans jobs already waiting in Redis.
 */
import { Queue, type JobsOptions } from "bullmq";
import { getRedis } from "./redis";
import { logger } from "./logger";

export const QUEUES = {
  /** Ticket events → automations, webhooks, notifications. */
  events: "deskforge-events",
  /** Outbound email. */
  email: "deskforge-email",
  /** Webhook deliveries with retry. */
  webhooks: "deskforge-webhooks",
  /** Repeating maintenance jobs: SLA sweep, IMAP polling, scheduled automations. */
  scheduler: "deskforge-scheduler",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const globalForQueues = globalThis as unknown as { queues?: Map<string, Queue> };

export function getQueue(name: QueueName): Queue {
  globalForQueues.queues ??= new Map();
  let q = globalForQueues.queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: getRedis(), defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000, attempts: 3, backoff: { type: "exponential", delay: 5000 } } });
    globalForQueues.queues.set(name, q);
  }
  return q;
}

/**
 * Enqueue a job. If Redis is unavailable the error is logged, not thrown: the
 * user's action (e.g. saving a ticket) must not fail because a side effect
 * could not be queued. The SLA sweep re-derives timer state from the database.
 */
export async function enqueue(name: QueueName, jobName: string, data: unknown, opts?: JobsOptions): Promise<void> {
  try {
    await getQueue(name).add(jobName, data, opts);
  } catch (err) {
    logger.error({ err, queue: name, jobName }, "failed to enqueue job");
  }
}
