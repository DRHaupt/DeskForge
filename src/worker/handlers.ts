/** Job name → handler. Each module registers its handlers here. */
import type { Job } from "bullmq";
import { db } from "../server/db";
import { getRedis } from "../server/redis";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- job payloads are validated inside each handler
export type JobHandler = (data: any, job: Job) => Promise<unknown>;

export const handlers: Record<string, JobHandler> = {
  /** Records that the worker is alive (shown on the admin health page). */
  heartbeat: async () => {
    await getRedis().set("deskforge:worker:heartbeat", new Date().toISOString(), "EX", 300);
    await db.$queryRaw`SELECT 1`;
    return { ok: true };
  },
};
