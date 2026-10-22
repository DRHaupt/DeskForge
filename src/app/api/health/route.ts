/**
 * Health check for load balancers / Docker. 200 when the database and Redis
 * answer, 503 otherwise. `?live=1` only checks that the process is up.
 */
import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { getRedis } from "@/server/redis";
import { getConfig } from "@/core/config/loader";
import pkg from "../../../../package.json";

export const dynamic = "force-dynamic";

async function check(fn: () => Promise<unknown>, timeoutMs = 2000): Promise<{ ok: boolean; ms: number; error?: string }> {
  const started = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs))]);
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: (err as Error).message };
  }
}

export async function GET(req: Request) {
  if (new URL(req.url).searchParams.has("live")) return NextResponse.json({ status: "ok" });
  const [database, redis] = await Promise.all([check(() => db.$queryRaw`SELECT 1`), check(() => getRedis().ping())]);
  let config: { ok: boolean; business?: string; error?: string };
  try {
    config = { ok: true, business: getConfig().branding.name };
  } catch (err) {
    config = { ok: false, error: (err as Error).message.split("\n")[0] };
  }
  const healthy = database.ok && redis.ok && config.ok;
  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", version: pkg.version, uptimeSeconds: Math.round(process.uptime()), checks: { database, redis, config } },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
