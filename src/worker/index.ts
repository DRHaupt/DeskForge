/**
 * Background worker: `npm run worker` (Docker: the `worker` service).
 * Consumes BullMQ queues and runs repeating maintenance jobs.
 */
import "dotenv/config";

import { Worker, type Job } from "bullmq";
import { getConfig } from "../core/config/loader";
import { getEnv } from "../server/env";
import { logger } from "../server/logger";
import { createRedis } from "../server/redis";
import { QUEUES, getQueue } from "../server/queue";
import { db } from "../server/db";
import { handlers } from "./handlers";

async function main() {
  getEnv();
  const cfg = getConfig();
  logger.info({ business: cfg.branding.name }, "worker starting");

  const connection = createRedis();
  const workers: Worker[] = [];
  for (const [queueKey, queueName] of Object.entries(QUEUES)) {
    const worker = new Worker(
      queueName,
      async (job: Job) => {
        const handler = handlers[job.name];
        if (!handler) {
          logger.warn({ queue: queueName, job: job.name }, "no handler for job");
          return;
        }
        const started = Date.now();
        const result = await handler(job.data, job);
        logger.debug({ queue: queueKey, job: job.name, id: job.id, ms: Date.now() - started }, "job done");
        return result;
      },
      { connection, concurrency: queueName === QUEUES.scheduler ? 1 : 5 },
    );
    worker.on("failed", (job, err) => logger.error({ err, queue: queueName, job: job?.name, id: job?.id, attempts: job?.attemptsMade }, "job failed"));
    workers.push(worker);
  }

  // Repeating jobs (idempotent: upsertJobScheduler replaces existing schedules).
  const scheduler = getQueue(QUEUES.scheduler);
  await scheduler.upsertJobScheduler("heartbeat", { every: 60_000 }, { name: "heartbeat" });
  for (const [id, every] of Object.entries(repeatingJobs())) {
    await scheduler.upsertJobScheduler(id, { every }, { name: id });
  }

  logger.info({ queues: Object.values(QUEUES) }, "worker ready");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    await Promise.allSettled(workers.map((w) => w.close()));
    await connection.quit().catch(() => undefined);
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

/** Repeating job ids → interval in ms. Extended as modules are added. */
function repeatingJobs(): Record<string, number> {
  return {
    "sla-sweep": 60_000,
    // Each mailbox has its own pollSeconds; this tick just checks which are due.
    "imap-poll": 15_000,
  };
}

main().catch((err) => {
  console.error(`✖ Worker failed to start:\n${(err as Error).message}`);
  process.exit(1);
});
