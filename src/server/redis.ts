/** Shared ioredis connections. BullMQ needs maxRetriesPerRequest: null. */
import { Redis } from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

export function createRedis(url = process.env.REDIS_URL ?? "redis://localhost:6379"): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
}

export function getRedis(): Redis {
  if (!globalForRedis.redis) globalForRedis.redis = createRedis();
  return globalForRedis.redis;
}
