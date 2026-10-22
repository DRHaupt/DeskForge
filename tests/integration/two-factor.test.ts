import { beforeAll, describe, expect, it, vi } from "vitest";
const current: { actor: unknown } = { actor: null };
vi.mock("@/server/session", () => ({ getCurrentActor: async () => current.actor }));

import { db } from "@/server/db";
import { totpCode } from "@/core/auth/totp";
import { decryptSecret } from "@/server/crypto";
import { beginEnrollment, confirmEnrollment, disableTwoFactor } from "@/server/services/two-factor";
import { GET as ticketsRoute } from "@/app/api/v1/tickets/route";
import { GET as meRoute } from "@/app/api/v1/me/route";
import { POST as beginRoute } from "@/app/api/v1/me/two-factor/route";
import { POST as confirmRoute } from "@/app/api/v1/me/two-factor/confirm/route";
import { ConflictError, ValidationError } from "@/core/errors";
import { actorFor, makeUser, params, req, setupBusiness } from "./helpers";

let leadId: string, agentId: string;

beforeAll(async () => {
  await setupBusiness("msp-it-support"); // requires 2FA for admin and team_lead
  leadId = (await makeUser("lead@northbeam-it.example", ["team_lead"])).id;
  agentId = (await makeUser("agent@northbeam-it.example", ["agent"])).id;
});

describe("two-factor enrolment", () => {
  it("flags users whose role requires 2FA", async () => {
    expect((await actorFor(leadId)).mustEnrollTwoFactor).toBe(true);
    expect((await actorFor(agentId)).mustEnrollTwoFactor).toBe(false);
  });

  it("blocks the API until enrolled, except setup routes", async () => {
    current.actor = await actorFor(leadId);
    const blocked = await ticketsRoute(req("/api/v1/tickets"), params());
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error).toMatch(/two-factor/);
    expect((await meRoute(req("/api/v1/me"), params())).status).toBe(200);

    const begin = await beginRoute(req("/api/v1/me/two-factor", { method: "POST", headers: { origin: "http://localhost:3000" } }), params());
    expect(begin.status).toBe(200);
    const { secret, qrSvg, otpauthUrl } = await begin.json();
    expect(qrSvg).toContain("<svg");
    expect(otpauthUrl).toContain("otpauth://totp/");

    const bad = await confirmRoute(req("/api/v1/me/two-factor/confirm", { body: { code: "000000" }, headers: { origin: "http://localhost:3000" } }), params());
    expect(bad.status).toBe(400);
    const ok = await confirmRoute(req("/api/v1/me/two-factor/confirm", { body: { code: totpCode(secret) }, headers: { origin: "http://localhost:3000" } }), params());
    expect(ok.status).toBe(200);

    current.actor = await actorFor(leadId);
    expect((current.actor as { mustEnrollTwoFactor: boolean }).mustEnrollTwoFactor).toBe(false);
    expect((await ticketsRoute(req("/api/v1/tickets"), params())).status).toBe(200);
    const stored = await db.user.findUniqueOrThrow({ where: { id: leadId } });
    expect(stored.totpSecret).not.toBe(secret); // encrypted at rest
    expect(decryptSecret(stored.totpSecret!)).toBe(secret);
  });

  it("required roles can't turn 2FA off; others need password and code", async () => {
    const lead = await actorFor(leadId);
    await expect(disableTwoFactor(lead, { password: "Test-Password-123!", code: "123456" })).rejects.toThrow(/requires two-factor/);
    await expect(beginEnrollment(lead)).rejects.toBeInstanceOf(ConflictError);

    const agent = await actorFor(agentId);
    const { secret } = await beginEnrollment(agent);
    await confirmEnrollment(agent, { code: totpCode(secret) });
    await expect(disableTwoFactor(agent, { password: "wrong", code: totpCode(secret) })).rejects.toBeInstanceOf(ValidationError);
    await expect(disableTwoFactor(agent, { password: "Test-Password-123!", code: "000000" })).rejects.toBeInstanceOf(ValidationError);
    await expect(disableTwoFactor(agent, { password: "Test-Password-123!", code: totpCode(secret) })).resolves.toEqual({ enabled: false });
  });

  it("single sign-on users are exempt", async () => {
    const u = await makeUser("sso-lead@northbeam-it.example", ["team_lead"]);
    await db.user.update({ where: { id: u.id }, data: { passwordHash: null } });
    expect((await actorFor(u.id)).mustEnrollTwoFactor).toBe(false);
  });
});

describe("password sign-in protection", () => {
  const login = async (email: string, password: string, otp?: string, ip = "203.0.113.9") => {
    const { _authorizeCredentialsForTests } = await import("@/server/auth");
    return _authorizeCredentialsForTests({ email, password, otp }, new Request("http://localhost/api/auth/callback/credentials", { headers: { "x-forwarded-for": ip } }));
  };

  it("counts wrong 2FA codes towards the lockout", async () => {
    const u = await makeUser("otp-user@northbeam-it.example", ["agent"]);
    const agent = await actorFor(u.id);
    const { secret } = await beginEnrollment(agent);
    await confirmEnrollment(agent, { code: totpCode(secret) });
    await expect(login(u.email, "Test-Password-123!")).rejects.toMatchObject({ code: "otp_required" });
    await expect(login(u.email, "Test-Password-123!", "000000", "203.0.113.10")).rejects.toMatchObject({ code: "otp_invalid" });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).failedLoginCount).toBe(1);
    await expect(login(u.email, "Test-Password-123!", totpCode(secret), "203.0.113.11")).resolves.toMatchObject({ id: u.id });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).failedLoginCount).toBe(0);
  });

  it("rate-limits attempts per account", async () => {
    // Unique per run: rate-limit counters live in Redis, which tests don't reset.
    const u = await makeUser(`hammered-${Date.now()}@northbeam-it.example`, ["requester"]);
    const codes: string[] = [];
    for (let i = 0; i < 12; i++) {
      // Vary the IP so only the per-account limit applies; the right password each time avoids the lockout.
      codes.push(await login(u.email, "Test-Password-123!", undefined, `198.51.100.${i}`).then(() => "ok", (e: { code: string }) => e.code));
    }
    // Fixed one-minute windows: if the run straddles a minute boundary the counter resets once.
    const firstLimited = codes.indexOf("rate_limited");
    expect(firstLimited === -1 || firstLimited >= 10).toBe(true);
    expect(codes.slice(0, 10).filter((c) => c === "ok").length).toBe(10);
    if (firstLimited === 10) expect(codes.slice(10)).toEqual(["rate_limited", "rate_limited"]);
  });
});
