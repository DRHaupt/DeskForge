import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/server/session", () => ({ getCurrentActor: async () => null }));

import { parseBusinessConfig, setConfig } from "@/core/config/loader";
import { ForbiddenError, ValidationError } from "@/core/errors";
import { db } from "@/server/db";
import { syncConfigToDatabase } from "@/server/config-sync";
import { MemoryTransport, setMailTransport, type MailTransport } from "@/server/mail/transport";
import { emailHistoryFor, sendSignInDetails, sendWelcomeEmail } from "@/server/services/onboarding";
import { POST as route } from "@/app/api/v1/users/[id]/signin-details/route";
import { actorFor, apiKeyFor, makeUser, params, req, resetDb } from "./helpers";

const base = parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../examples/internal-it.yaml"), "utf8"));
function configure(over: (raw: any) => void = () => {}) {
  const raw = structuredClone(base);
  raw.email = { ...raw.email, enabled: true };
  raw.onboarding = { enabled: true };
  over(raw);
  const cfg = parseBusinessConfig(raw);
  setConfig(cfg);
  return cfg;
}
const mail = new MemoryTransport();
const PASSWORD = "Tq7#xP<&>2wz";
let adminId: string, agentId: string, newId: string;

beforeAll(async () => {
  const cfg = configure();
  await resetDb();
  await syncConfigToDatabase(db, cfg);
  adminId = (await makeUser("boss@drhaupt.example", ["admin"], { name: "Boss Person" })).id;
  agentId = (await makeUser("tech@drhaupt.example", ["agent"])).id;
  newId = (await makeUser("jamie.new@drhaupt.example", ["requester"], { name: "Jamie New" })).id;
  await db.user.update({ where: { id: newId }, data: { scimUserName: "Jamie.New@drhaupt.example" } });
});

beforeEach(() => {
  configure();
  mail.sent.length = 0;
  setMailTransport(mail);
});

describe("send sign-in details", () => {
  it("emails the username and temporary password, and never stores the password", async () => {
    const res = await sendSignInDetails(await actorFor(adminId), newId, `  ${PASSWORD} `);
    expect(res).toEqual({ sentTo: "jamie.new@drhaupt.example" });
    const [m] = mail.sent;
    expect(m!.to).toBe("jamie.new@drhaupt.example");
    expect(m!.subject).toContain("sign-in details");
    expect(m!.text).toContain(`Temporary password: ${PASSWORD}`);
    expect(m!.text).toContain("Username: Jamie.New@drhaupt.example");
    expect(m!.text).toContain("Hi Jamie,");
    expect(m!.html).toContain("Tq7#xP&lt;&amp;&gt;2wz");
    expect(m!.html).toContain("/welcome?email=jamie.new%40drhaupt.example");

    const row = await db.outboundEmail.findFirstOrThrow({ where: { kind: "onboarding.credentials" }, orderBy: { createdAt: "desc" } });
    expect(row.status).toBe("SENT");
    expect(row.text).toContain("Temporary password: ••••••••");
    const everything = JSON.stringify([await db.outboundEmail.findMany(), await db.auditLog.findMany()]);
    expect(everything).not.toContain("Tq7#xP");
    expect(everything).not.toContain("Tq7#xP&lt;");

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "user.signin_details_sent", entityId: newId } });
    expect(audit.actorLabel).toBe("boss@drhaupt.example");
  });

  it("is admin-only, over the API too", async () => {
    await expect(sendSignInDetails(await actorFor(agentId), newId, PASSWORD)).rejects.toBeInstanceOf(ForbiddenError);
    const denied = await route(req(`/api/v1/users/${newId}/signin-details`, { body: { temporaryPassword: PASSWORD }, key: await apiKeyFor(agentId) }), params({ id: newId }));
    expect(denied.status).toBe(403);
    const ok = await route(req(`/api/v1/users/${newId}/signin-details`, { body: { temporaryPassword: PASSWORD }, key: await apiKeyFor(adminId) }), params({ id: newId }));
    expect(ok.status).toBe(200);
    // The generic API audit entry (which would include the body) is skipped.
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain("Tq7#xP");
  });

  it("refuses when email is off, and rejects multi-line input", async () => {
    const admin = await actorFor(adminId);
    await expect(sendSignInDetails(admin, newId, "line1\nline2")).rejects.toBeInstanceOf(ValidationError);
    configure((raw) => (raw.email.enabled = false));
    await expect(sendSignInDetails(admin, newId, PASSWORD)).rejects.toThrow(/Email is turned off/);
    expect(mail.sent).toHaveLength(0);
  });

  it("reports SMTP failures right away and logs them without the password", async () => {
    const failing: MailTransport = { name: "smtp", send: async () => { throw new Error("535 Authentication failed"); } };
    setMailTransport(failing);
    await expect(sendSignInDetails(await actorFor(adminId), newId, PASSWORD)).rejects.toThrow(/535 Authentication failed/);
    const row = await db.outboundEmail.findFirstOrThrow({ where: { kind: "onboarding.credentials" }, orderBy: { createdAt: "desc" } });
    expect(row).toMatchObject({ status: "FAILED", error: "535 Authentication failed" });
    expect(row.html).not.toContain("Tq7#xP");
  });
});

describe("email history on the user page", () => {
  it("lists emails to this person with who sent them and any error", async () => {
    const admin = await actorFor(adminId);
    await sendWelcomeEmail(admin, newId);
    const history = await emailHistoryFor(admin, newId);
    expect(history[0]).toMatchObject({ kind: "onboarding.welcome", sentBy: "boss@drhaupt.example" });
    const failed = history.find((h) => h.status === "FAILED");
    expect(failed?.error).toBe("535 Authentication failed");
    expect(history.some((h) => h.kind === "onboarding.credentials" && h.status === "SENT")).toBe(true);
  });
});
