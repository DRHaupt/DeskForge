/**
 * Runs at container start: sync business.config.yaml into the database and, on
 * a fresh install, create the first admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 */
import "dotenv/config";
import { getConfig } from "../src/core/config/loader";
import { checkPassword } from "../src/core/auth/password";
import { syncConfigToDatabase } from "../src/server/config-sync";
import { db } from "../src/server/db";
import { hashPassword } from "../src/server/passwords";
import { provisionUser } from "../src/server/users";

async function bootstrapAdmin() {
  const admins = await db.user.count({ where: { isActive: true, roles: { some: { role: { permissions: { has: "*" } } } } } });
  if (admins > 0) return;
  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn("⚠ No admin account exists. Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env and restart to create one.");
    return;
  }
  const problems = checkPassword(password, getConfig().auth.local.passwordPolicy);
  if (problems.length) {
    console.error(`✖ SEED_ADMIN_PASSWORD does not meet the password policy: ${problems.join(", ")}`);
    return;
  }
  const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    const adminRole = await db.role.findUniqueOrThrow({ where: { key: "admin" } });
    await db.userRole.upsert({ where: { userId_roleId: { userId: existing.id, roleId: adminRole.id } }, create: { userId: existing.id, roleId: adminRole.id }, update: {} });
    console.log(`✔ Granted admin role to existing user ${email}`);
    return;
  }
  await provisionUser({ email, name: "Administrator", passwordHash: await hashPassword(password), roleKeys: ["admin"], organizationId: null });
  console.log(`✔ Created first admin account: ${email}`);
}

async function main() {
  const cfg = getConfig();
  const report = await syncConfigToDatabase(db, cfg);
  console.log(`✔ Config synced for ${cfg.branding.name}: ${report.ticketTypes} types, ${report.slaPolicies} SLA policies, ${report.categories} categories, ${report.teams} new teams`);
  if (report.deactivated.length) console.log(`  deactivated: ${report.deactivated.join(", ")}`);
  await bootstrapAdmin();
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(`✖ Config sync failed:\n${(err as Error).message}`);
  await db.$disconnect();
  process.exit(1);
});
