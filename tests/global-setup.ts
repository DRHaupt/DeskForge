/** Prepare a clean test database once per run: drop schema, apply migrations. */
import "dotenv/config";
import { execSync } from "node:child_process";
import pg from "pg";

export default async function setup() {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!.replace(/\/(\w+)(\?|$)/, "/$1_test$2");
  if (!base.includes("test")) throw new Error(`Refusing to reset non-test database: ${base}`);
  const client = new pg.Client({ connectionString: base });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await client.end();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: base }, stdio: "pipe" });
}
