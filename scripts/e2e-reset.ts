/**
 * Prepares the end-to-end test environment: (re)creates the e2e database,
 * applies migrations and empties the e2e Redis database. Seeding is done
 * afterwards by prisma/seed.ts. Never point this at a real database.
 */
import { execSync } from "node:child_process";
import { Client } from "pg";
import IORedis from "ioredis";

const url = process.env.DATABASE_URL;
if (!url || !/e2e/.test(new URL(url).pathname)) {
  console.error("Refusing to reset: DATABASE_URL must point at a database whose name contains 'e2e'.");
  process.exit(1);
}

async function main() {
  const target = new URL(url!);
  const dbName = target.pathname.slice(1);
  const admin = new URL(url!);
  admin.pathname = "/postgres";
  const c = new Client({ connectionString: admin.toString() });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await c.query(`CREATE DATABASE "${dbName}"`);
  await c.end();
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });

  const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379/1", { maxRetriesPerRequest: 1 });
  await redis.flushdb();
  await redis.quit();
  console.log(`e2e database "${dbName}" ready`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
