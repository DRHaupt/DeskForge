import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/server/session", () => ({ getCurrentActor: async () => null }));

import { parseBusinessConfig, setConfig } from "@/core/config/loader";
import { db } from "@/server/db";
import { syncConfigToDatabase } from "@/server/config-sync";
import { MemoryTransport, setMailTransport } from "@/server/mail/transport";
import { completeOnboarding, onboardingState, recordSsoMfa, sendWelcomeEmail } from "@/server/services/onboarding";
import { beginEnrollment, confirmEnrollment } from "@/server/services/two-factor";
import { totpCode } from "@/core/auth/totp";
import { POST as welcomeRoute } from "@/app/api/v1/users/[id]/welcome/route";
import { ForbiddenError, ValidationError } from "@/core/errors";
import { actorFor, apiKeyFor, makeUser, params, req, resetDb } from "./helpers";

const base = parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../examples/internal-it.yaml"), "utf8"));
function configWith(onboarding: object) {
  const raw = structuredClone(base);
  raw.auth.oidc = [{ id: "entra", type: "microsoft-entra-id", label: "Sign in with Microsoft", envPrefix: "OIDC_ENTRA", allowedDomains: ["drhaupt.example"] }];
  raw.onboarding = { enabled: true, provider: "entra", ...onboarding };
  const cfg = parseBusinessConfig(raw);
  setConfig(cfg);
  return cfg;
}
const mail = new MemoryTransport();
let adminId: string, ssoId: string, pwId: string, agentId: string;

beforeAll(async () => {
  const cfg = configWith({
    welcome: { title: "Welcome to the team", message: "First paragraph.\n\nSecond paragraph.", links: [{ label: "Help articles", url: "/portal/kb" }] },
    email: { subject: "Your account is ready", message: "Hi {{firstName}},\n\nPlease set up your account." },
  });
  await resetDb();
  await syncConfigToDatabase(db, cfg);
  setMailTransport(mail);
  adminId = (await makeUser("boss@drhaupt.example", ["admin"], { name: "Boss Person" })).id;
  agentId = (await makeUser("tech@drhaupt.example", ["agent"], { name: "Tech Person" })).id;
  const sso = await makeUser("newhire@drhaupt.example", ["requester"], { name: "Jamie New" });
  ssoId = sso.id;
  await db.user.update({ where: { id: ssoId }, data: { passwordHash: null } });
  await db.userIdentity.create({ data: { userId: ssoId, provider: "entra", providerAccountId: "oid-1" } });
  pwId = (await makeUser("local@drhaupt.example", ["requester"], { name: "Local User" })).id;
});

const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;

describe("config", () => {
  it("validates the onboarding provider", () => {
    const raw = structuredClone(base);
    raw.onboarding = { enabled: true, provider: "nope" };
    expect(() => parseBusinessConfig(raw)).toThrow(/onboarding\.provider/);
    raw.onboarding = { enabled: true, provider: "google", checkRegisteredMethods: true };
    expect(() => parseBusinessConfig(raw)).toThrow(/microsoft-entra-id/);
    configWith({}); // restore
  });
});

describe("MFA recording on SSO sign-in", () => {
  it("records an MFA sign-in from the amr claim", async () => {
    const fetchSpy = vi.fn();
    expect(await recordSsoMfa(ssoId, "entra", { profile: { amr: ["pwd"] }, accessToken: jwt({ amr: ["pwd"] }) }, fetchSpy)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled(); // Graph check is off
    expect((await onboardingState(await actorFor(ssoId))).step).toBe("mfa");
    expect(await recordSsoMfa(ssoId, "entra", { profile: { amr: ["pwd"] }, accessToken: jwt({ amr: ["pwd", "mfa"] }) })).toBe("sign-in");
    const s = await onboardingState(await actorFor(ssoId));
    expect(s).toMatchObject({ step: "welcome", method: "sso", mfaVerifiedVia: "sign-in" });
    await db.user.update({ where: { id: ssoId }, data: { mfaVerifiedAt: null, mfaVerifiedVia: null } });
  });

  it("can check Microsoft Graph for a registered authenticator", async () => {
    configWith({ checkRegisteredMethods: true });
    const graph = (body: object, ok = true) => vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 403 }));
    expect(await recordSsoMfa(ssoId, "entra", { accessToken: "tok" }, graph({ value: [{ "@odata.type": "#microsoft.graph.passwordAuthenticationMethod" }] }))).toBeNull();
    expect(await recordSsoMfa(ssoId, "entra", { accessToken: "tok" }, graph({ error: "forbidden" }, false))).toBeNull();
    const ok = graph({ value: [{ "@odata.type": "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod" }] });
    expect(await recordSsoMfa(ssoId, "entra", { accessToken: "tok" }, ok)).toBe("registered");
    expect(ok).toHaveBeenCalledWith("https://graph.microsoft.com/v1.0/me/authentication/methods", expect.objectContaining({ headers: { authorization: "Bearer tok" } }));
    // Other providers never trigger the Graph call.
    const other = vi.fn();
    expect(await recordSsoMfa(ssoId, "google", { accessToken: "tok" }, other)).toBeNull();
    expect(other).not.toHaveBeenCalled();
    configWith({ welcome: { title: "Welcome to the team", message: "First paragraph.\n\nSecond paragraph.", links: [{ label: "Help articles", url: "/portal/kb" }] }, email: { subject: "Your account is ready", message: "Hi {{firstName}},\n\nPlease set up your account." } });
  });
});

describe("onboarding steps", () => {
  it("password users use the app's own 2FA for the MFA step", async () => {
    const local = await actorFor(pwId);
    expect(await onboardingState(local)).toMatchObject({ step: "mfa", method: "password" });
    await expect(completeOnboarding(local)).rejects.toBeInstanceOf(ValidationError);
    const { secret } = await beginEnrollment(local);
    await confirmEnrollment(local, { code: totpCode(secret) });
    expect(await onboardingState(local)).toMatchObject({ step: "welcome", mfaVerifiedVia: "app" });
  });

  it("skips the MFA step when it isn't required", async () => {
    configWith({ requireMfa: false });
    expect((await onboardingState(await actorFor(agentId))).step).toBe("welcome");
    configWith({ welcome: { title: "Welcome to the team", message: "x" }, email: { subject: "Your account is ready", message: "Hi {{firstName}},\n\nPlease set up your account." } });
  });

  it("finishing notifies admins once", async () => {
    const local = await actorFor(pwId);
    expect(await completeOnboarding(local)).toEqual({ firstTime: true });
    expect(await completeOnboarding(local)).toEqual({ firstTime: false });
    const notes = await db.notification.findMany({ where: { type: "user.onboarded" } });
    expect(notes.map((n) => n.userId)).toEqual([adminId]);
    expect(notes[0]!.title).toBe("Local User finished onboarding");
    expect((await db.user.findUniqueOrThrow({ where: { id: pwId } })).onboardedAt).not.toBeNull();
  });
});

describe("welcome email", () => {
  it("sends a personal link, admins only", async () => {
    mail.sent.length = 0;
    const admin = await actorFor(adminId);
    const { link } = await sendWelcomeEmail(admin, ssoId);
    expect(link).toBe("http://localhost:3000/welcome?email=newhire%40drhaupt.example");
    const [m] = mail.sent;
    expect(m!.to).toBe("newhire@drhaupt.example");
    expect(m!.subject).toBe("Your account is ready");
    expect(m!.text).toContain("Hi Jamie,");
    expect(m!.html).toContain("/welcome?email=newhire%40drhaupt.example");
    await expect(sendWelcomeEmail(await actorFor(agentId), ssoId)).rejects.toBeInstanceOf(ForbiddenError);
    const res = await welcomeRoute(req(`/api/v1/users/${ssoId}/welcome`, { body: {}, key: await apiKeyFor(agentId) }), params({ id: ssoId }));
    expect(res.status).toBe(403);
    const ok = await welcomeRoute(req(`/api/v1/users/${ssoId}/welcome`, { body: {}, key: await apiKeyFor(adminId) }), params({ id: ssoId }));
    expect(ok.status).toBe(200);
  });

  it("refuses when onboarding is off", async () => {
    const raw = structuredClone(base);
    setConfig(parseBusinessConfig(raw));
    await expect(sendWelcomeEmail(await actorFor(adminId), ssoId)).rejects.toThrow(/turned off/);
    configWith({});
  });
});
