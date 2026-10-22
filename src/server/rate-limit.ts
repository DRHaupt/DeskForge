/**
 * Fixed-window rate limiter backed by Redis, with an in-memory fallback so a
 * Redis outage degrades to per-process limiting instead of failing requests.
 */
import { getRedis } from "./redis";
import { logger } from "./logger";

const memory = new Map<string, { count: number; resetAt: number }>();

export type RateLimitResult = { allowed: boolean; remaining: number; resetSeconds: number };

export async function rateLimit(key: string, limit: number, windowSeconds = 60): Promise<RateLimitResult> {
  const windowId = Math.floor(Date.now() / 1000 / windowSeconds);
  const redisKey = `rl:${key}:${windowId}`;
  const resetSeconds = windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
  try {
    const redis = getRedis();
    if (redis.status !== "ready") throw new Error(`redis ${redis.status}`);
    const count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, windowSeconds + 1);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetSeconds };
  } catch (err) {
    logger.debug({ err }, "rate limit falling back to memory");
    const now = Date.now();
    const entry = memory.get(redisKey);
    if (!entry || entry.resetAt < now) {
      memory.set(redisKey, { count: 1, resetAt: now + windowSeconds * 1000 });
      if (memory.size > 10_000) for (const [k, v] of memory) if (v.resetAt < now) memory.delete(k);
      return { allowed: true, remaining: limit - 1, resetSeconds };
    }
    entry.count++;
    return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), resetSeconds };
  }
}
