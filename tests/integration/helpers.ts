/** Shared fixtures for integration tests (real Postgres, test database). */
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { parseBusinessConfigYaml, setConfig } from "@/core/config/loader";
import type { BusinessConfig } from "@/core/config/schema";
import { syncConfigToDatabase } from "@/server/config-sync";
import { db } from "@/server/db";
import { generateApiKey } from "@/server/api-keys";
import { loadUserActor } from "@/server/actor";
import { hashPassword } from "@/server/passwords";

export function loadExample(name = "msp-it-support"): BusinessConfig {
  const file = path.resolve(import.meta.dirname, `../../examples/${name}.yaml`);
  const cfg = parseBusinessConfigYaml(fs.readFileSync(file, "utf8"), file);
  setConfig(cfg);
  return cfg;
}

const TABLES = [
  "audit_logs", "notifications", "automation_runs", "automations", "webhook_deliveries", "webhooks", "csat_responses", "approvals",
  "catalog_requests", "catalog_items", "article_feedback", "knowledge_articles", "kb_categories", "sla_instances", "sla_policies",
  "relationships", "saved_views", "ticket_tags", "tags", "ticket_watchers", "status_history", "attachments", "comments",
  "ticket_field_values", "inbound_emails", "tickets", "ticket_field_defs", "ticket_types", "categories", "assets", "canned_responses",
  "api_keys", "team_members", "teams", "user_roles", "user_identities", "users", "roles", "organizations", "system_settings",
];

export async function resetDb() {
  await db.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

let pwHash: string | undefined;
export async function makeUser(email: string, roleKeys: string[], extra: { organizationId?: string; name?: string } = {}) {
  pwHash ??= await hashPassword("Test-Password-123!");
  const roles = await db.role.findMany({ where: { key: { in: roleKeys } } });
  return db.user.create({
    data: {
      email,
      name: extra.name ?? email.split("@")[0]!,
      passwordHash: pwHash,
      organizationId: extra.organizationId,
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
  });
}

export async function actorFor(userId: string) {
  const a = await loadUserActor(db, userId);
  if (!a) throw new Error("no actor");
  return a;
}

/** Create an API key with full scopes for a user; requests act as that user (capped by their permissions). */
export async function apiKeyFor(userId: string): Promise<string> {
  const { key, prefix, hashedKey } = generateApiKey();
  await db.apiKey.create({ data: { name: `test-${prefix}`, prefix, hashedKey, permissions: ["*"], createdById: userId } });
  return key;
}

export function req(url: string, init: { method?: string; body?: unknown; key?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.key) headers.authorization = `Bearer ${init.key}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

export const params = (p: Record<string, string> = {}) => ({ params: Promise.resolve(p) });

export async function setupBusiness(name = "msp-it-support") {
  const cfg = loadExample(name);
  await resetDb();
  await syncConfigToDatabase(db, cfg);
  return cfg;
}
