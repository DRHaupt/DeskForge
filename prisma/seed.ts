/**
 * Seeds a realistic demo for whichever business config is active.
 *
 *   npm run db:seed            # seed if the database has no users yet
 *   npm run db:seed -- --force # seed even if users exist (adds missing demo data)
 *
 * Demo users all share SEED_DEMO_PASSWORD (default below). Change or remove
 * them before going live — see docs/DEPLOYING-A-NEW-BUSINESS.md.
 */
import "dotenv/config";
import { getConfig } from "../src/core/config/loader";
import { syncConfigToDatabase } from "../src/server/config-sync";
import { db } from "../src/server/db";
import { hashPassword } from "../src/server/passwords";
import { demoPeople } from "./seed/people";
import { seedDemoContent } from "./seed/content";
import { setSideEffects } from "../src/server/side-effects";
import { closeQueues } from "../src/server/queue";
import { getRedis } from "../src/server/redis";

export const DEFAULT_DEMO_PASSWORD = "DeskForge-Demo-2026!";
const SEED_FLAG = "seed.demo_completed_at";

async function main() {
  // Demo data must never send email or trigger webhooks.
  setSideEffects(false);
  const force = process.argv.includes("--force");
  const cfg = getConfig();
  const done = await db.systemSetting.findUnique({ where: { key: SEED_FLAG } });
  if (done && !force) {
    console.log(`Demo data was already seeded on ${String(done.value)} — skipping (use --force to run again).`);
    return;
  }
  if (!done && (await db.ticket.count()) > 0 && !force) {
    console.log("Database already contains tickets — skipping demo seed (use --force to run anyway).");
    return;
  }

  console.log(`Seeding demo data for "${cfg.branding.name}"…`);
  await syncConfigToDatabase(db, cfg);

  const password = process.env.SEED_DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || password;
  const passwordHash = await hashPassword(password);
  const adminHash = adminPassword === password ? passwordHash : await hashPassword(adminPassword);
  const roles = new Map((await db.role.findMany()).map((r) => [r.key, r.id]));
  const orgs = new Map((await db.organization.findMany()).map((o) => [o.slug, o.id]));

  for (const [i, p] of demoPeople(cfg).entries()) {
    const found = await db.user.findUnique({ where: { email: p.email } });
    if (found) continue;
    await db.user.create({
      data: {
        email: p.email,
        name: p.name,
        passwordHash: i === 0 ? adminHash : passwordHash,
        passwordChangedAt: new Date(),
        organizationId: p.orgSlug ? orgs.get(p.orgSlug) : undefined,
        orgTicketAccess: cfg.portal.requestersSeeOrgTickets,
        roles: { create: p.roles.filter((r) => roles.has(r)).map((r) => ({ roleId: roles.get(r)! })) },
      },
    });
  }
  // Second sync attaches the config's team members now that their accounts exist.
  await syncConfigToDatabase(db, cfg);

  await seedDemoContent(db, cfg);

  await db.systemSetting.upsert({ where: { key: SEED_FLAG }, create: { key: SEED_FLAG, value: new Date().toISOString() }, update: { value: new Date().toISOString() } });
  const admin = demoPeople(cfg)[0]!;
  console.log(`✔ Seed complete. Admin: ${admin.email}. Demo users (agents, requesters) use password: ${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues();
    await getRedis().quit().catch(() => undefined);
    await db.$disconnect();
  });
