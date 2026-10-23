/**
 * Onboarding: the /welcome flow that onboarding emails link to.
 *
 *   1. Sign in (with the configured SSO provider, or email and password).
 *   2. Multi-factor: SSO users must have an MFA sign-in (or, optionally, an
 *      authenticator registered with Entra); password users enrol in the app's
 *      own TOTP 2FA.
 *   3. Welcome: the configured message and links, then into the portal.
 */
import { getConfig } from "@/core/config/loader";
import { decodeJwtClaims, hasStrongMethod, onboardingStep, signInUsedMfa, type OnboardingStep } from "@/core/auth/mfa";
import { NotFoundError, ValidationError } from "@/core/errors";
import { assertCan, isAgent, type Actor, type UserActor } from "@/core/rbac/actor";
import { WILDCARD } from "@/core/rbac/permissions";
import { audit, type AuditContext } from "../audit";
import { db } from "../db";
import { logger } from "../logger";
import { queueEmail } from "../mail/outbound";
import { appUrl } from "../mail/templates";
import { notifyUsers } from "./notifications";

const GRAPH_METHODS_URL = "https://graph.microsoft.com/v1.0/me/authentication/methods";

/** Does the onboarding provider need the Graph permission requested at sign-in? */
export function graphScopeFor(providerId: string): boolean {
  const o = getConfig().onboarding;
  return o.enabled && o.checkRegisteredMethods && o.provider === providerId;
}

/**
 * Called on every SSO sign-in. Records that MFA is in place when the sign-in
 * used MFA, or (if enabled) when Microsoft Graph shows a registered
 * authenticator. Never throws: failures are logged and onboarding just asks again.
 */
export async function recordSsoMfa(
  userId: string,
  providerId: string,
  tokens: { profile?: Record<string, unknown> | null; idToken?: string | null; accessToken?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<"sign-in" | "registered" | null> {
  try {
    let via: "sign-in" | "registered" | null = null;
    if (signInUsedMfa(tokens.profile, decodeJwtClaims(tokens.idToken), decodeJwtClaims(tokens.accessToken))) {
      via = "sign-in";
    } else if (graphScopeFor(providerId) && tokens.accessToken) {
      const res = await fetchImpl(GRAPH_METHODS_URL, { headers: { authorization: `Bearer ${tokens.accessToken}` }, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const body = (await res.json()) as { value?: unknown };
        if (hasStrongMethod(body.value)) via = "registered";
      } else {
        logger.warn({ status: res.status, userId }, "Graph authentication methods check failed (is UserAuthenticationMethod.Read consented?)");
      }
    }
    if (via) await db.user.update({ where: { id: userId }, data: { mfaVerifiedAt: new Date(), mfaVerifiedVia: via } });
    return via;
  } catch (err) {
    logger.warn({ err, userId }, "could not record MFA status");
    return null;
  }
}

export type OnboardingState = {
  step: OnboardingStep;
  /** "sso" when the person signs in with the onboarding provider, "password" otherwise. */
  method: "sso" | "password";
  providerLabel: string | null;
  mfaVerifiedAt: Date | null;
  mfaVerifiedVia: string | null;
  onboardedAt: Date | null;
};

export async function onboardingState(actor: UserActor | null): Promise<OnboardingState> {
  const o = getConfig().onboarding;
  const provider = o.provider ? getConfig().auth.oidc.find((p) => p.id === o.provider) : undefined;
  if (!actor) return { step: "signin", method: provider ? "sso" : "password", providerLabel: provider?.label ?? null, mfaVerifiedAt: null, mfaVerifiedVia: null, onboardedAt: null };
  const user = await db.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { onboardedAt: true, mfaVerifiedAt: true, mfaVerifiedVia: true, totpEnabled: true, identities: { select: { provider: true } } },
  });
  const sso = Boolean(provider && user.identities.some((i) => i.provider === provider.id));
  const mfaDone = sso ? Boolean(user.mfaVerifiedAt) : user.totpEnabled;
  return {
    step: onboardingStep({ signedIn: true, requireMfa: o.requireMfa, mfaDone }),
    method: sso ? "sso" : "password",
    providerLabel: provider?.label ?? null,
    mfaVerifiedAt: sso ? user.mfaVerifiedAt : user.totpEnabled ? (user.mfaVerifiedAt ?? null) : null,
    mfaVerifiedVia: sso ? user.mfaVerifiedVia : user.totpEnabled ? "app" : null,
    onboardedAt: user.onboardedAt,
  };
}

/** Mark onboarding finished (idempotent) and let admins know the first time. */
export async function completeOnboarding(actor: UserActor, ctx?: AuditContext): Promise<{ firstTime: boolean }> {
  const state = await onboardingState(actor);
  if (state.step !== "welcome") throw new ValidationError("Finish the earlier steps first");
  const updated = await db.user.updateMany({ where: { id: actor.id, onboardedAt: null }, data: { onboardedAt: new Date() } });
  if (updated.count === 0) return { firstTime: false };
  await audit(actor, { action: "user.onboarded", entityType: "user", entityId: actor.id, changes: { mfa: state.mfaVerifiedVia } }, ctx);
  if (getConfig().onboarding.notifyAdmins) {
    const admins = await db.user.findMany({
      where: { isActive: true, roles: { some: { role: { OR: [{ permissions: { has: WILDCARD } }, { permissions: { has: "user.manage" } }] } } } },
      select: { id: true },
    });
    await notifyUsers(admins.map((a) => a.id), { type: "user.onboarded", title: `${actor.name} finished onboarding`, body: actor.email, link: `/admin/users/${actor.id}` }, actor.id);
  }
  return { firstTime: true };
}

export function welcomeLink(email?: string): string {
  return appUrl(`/welcome${email ? `?email=${encodeURIComponent(email)}` : ""}`);
}

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

/** Blank lines separate paragraphs; single line breaks are kept (lists, addresses). */
function paragraphs(text: string, vars: Record<string, string>): string[] {
  return fill(text, vars)
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((l) => l.trimEnd()).join("\n").trim())
    .filter(Boolean);
}

/** Email someone their personal welcome link. Admins only. */
export async function sendWelcomeEmail(actor: Actor, userId: string, ctx?: AuditContext) {
  assertCan(actor, "user.manage");
  const cfg = getConfig();
  if (!cfg.onboarding.enabled) throw new ValidationError("Onboarding is turned off (onboarding.enabled in business.config.yaml)");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) throw new NotFoundError("User");
  const link = welcomeLink(user.email);
  const e = cfg.onboarding.email;
  const vars = { firstName: user.name.split(" ")[0] ?? user.name, name: user.name, company: cfg.branding.name, supportEmail: cfg.branding.supportEmail };
  await queueEmail({
    kind: "onboarding.welcome",
    to: user.email,
    subject: fill(e.subject, vars),
    content: {
      heading: fill(e.heading, vars),
      preheader: `Your ${cfg.branding.name} account is ready. Sign in and set up multi-factor authentication.`,
      paragraphs: paragraphs(e.message, vars),
      button: { label: fill(e.buttonLabel, vars), url: link },
      signature: [...e.signature.map((l) => fill(l, vars)), cfg.branding.name],
      footerNote: `You're receiving this email because an account was created for you at ${cfg.branding.name}.`,
    },
  });
  await audit(actor, { action: "user.welcome_sent", entityType: "user", entityId: user.id }, ctx);
  return { link };
}

/** Where to go after the welcome step. */
export function homeFor(actor: UserActor): string {
  return isAgent(actor) ? "/agent" : "/portal";
}
