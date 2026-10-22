/**
 * Auth.js (NextAuth v5) setup: local credentials + OIDC providers from config.
 *
 * Sessions are JWTs holding only the user id and a session version. Roles and
 * permissions are loaded from the database on every request (see
 * src/server/session.ts), so role edits and deactivations apply immediately.
 */
import NextAuth, { CredentialsSignin, type NextAuthConfig } from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { z } from "zod";
import { getConfig } from "@/core/config/loader";
import type { BusinessConfig } from "@/core/config/schema";
import { systemActor } from "@/core/rbac/actor";
import { audit } from "./audit";
import { db } from "./db";
import { envValue } from "./env";
import { logger } from "./logger";
import { dummyVerify, verifyPassword } from "./passwords";
import { verifyTotp } from "./totp";
import { rateLimit } from "./rate-limit";
import { clientIpFrom } from "./client-ip";
import { normalizeEmail, provisionUser } from "./users";

class InvalidLogin extends CredentialsSignin {
  code = "invalid_credentials";
}
class LockedOut extends CredentialsSignin {
  code = "locked";
}
class OtpRequired extends CredentialsSignin {
  code = "otp_required";
}
class OtpInvalid extends CredentialsSignin {
  code = "otp_invalid";
}
class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}

/** Sign-in attempts allowed per minute, per client IP and per account. */
const LOGIN_LIMIT_PER_IP = 20;
const LOGIN_LIMIT_PER_EMAIL = 10;

const credentialsSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(256),
  // Anything that isn't a plausible code counts as "no code" (asks for one) rather than a wrong code.
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/)
    .optional()
    .catch(undefined),
});

type OidcProviderConfig = BusinessConfig["auth"]["oidc"][number];

/** OIDC providers whose secrets are present in the environment. */
export function configuredOidcProviders(cfg: BusinessConfig): OidcProviderConfig[] {
  return cfg.auth.oidc.filter((p) => envValue(p.envPrefix, "CLIENT_ID") && envValue(p.envPrefix, "CLIENT_SECRET"));
}

function buildOidcProvider(p: OidcProviderConfig): Provider {
  const clientId = envValue(p.envPrefix, "CLIENT_ID")!;
  const clientSecret = envValue(p.envPrefix, "CLIENT_SECRET")!;
  const issuer = envValue(p.envPrefix, "ISSUER");
  if (p.type === "microsoft-entra-id") {
    return MicrosoftEntraID({ id: p.id, name: p.label, clientId, clientSecret, issuer });
  }
  if (p.type === "google") {
    return Google({ id: p.id, name: p.label, clientId, clientSecret });
  }
  if (!issuer) throw new Error(`OIDC provider "${p.id}" (generic) needs ${p.envPrefix}_ISSUER`);
  return { id: p.id, name: p.label, type: "oidc", issuer, clientId, clientSecret } as Provider;
}

async function authorizeCredentials(raw: unknown, request: Request) {
  const cfg = getConfig();
  if (!cfg.auth.local.enabled) throw new InvalidLogin();
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidLogin();
  const email = normalizeEmail(parsed.data.email);
  const ip = clientIpFrom(request.headers);

  const [byIp, byEmail] = await Promise.all([rateLimit(`login:ip:${ip ?? "unknown"}`, LOGIN_LIMIT_PER_IP), rateLimit(`login:email:${email}`, LOGIN_LIMIT_PER_EMAIL)]);
  if (!byIp.allowed || !byEmail.allowed) throw new RateLimited();

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !user.isActive) {
    await dummyVerify();
    throw new InvalidLogin();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new LockedOut();

  // Wrong passwords and wrong 2FA codes both count towards the lockout.
  const fail = async (err: CredentialsSignin, reason: string): Promise<never> => {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= cfg.auth.local.maxFailedAttempts;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + cfg.auth.local.lockoutMinutes * 60_000) : user.lockedUntil,
      },
    });
    await audit(systemActor("auth"), { action: lock ? "auth.locked" : "auth.failed", entityType: "user", entityId: user.id, changes: { reason } }, { ip });
    throw lock ? new LockedOut() : err;
  };

  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) await fail(new InvalidLogin(), "password");

  if (user.totpEnabled && user.totpSecret) {
    if (!parsed.data.otp) throw new OtpRequired();
    if (!verifyTotp(user.totpSecret, parsed.data.otp)) await fail(new OtpInvalid(), "otp");
  }

  await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await audit(systemActor("auth"), { action: "auth.login", entityType: "user", entityId: user.id, changes: { method: "password" } }, { ip });
  return { id: user.id, email: user.email, name: user.name };
}

/**
 * Map an OIDC sign-in to a local user: existing identity → existing user by
 * email (linked) → auto-provisioned user (if allowed). Returns the user id or null.
 */
export async function resolveOidcUser(
  providerCfg: OidcProviderConfig,
  providerAccountId: string,
  profile: { email?: string | null; name?: string | null; email_verified?: boolean | null; preferred_username?: string | null },
): Promise<string | null> {
  const identity = await db.userIdentity.findUnique({
    where: { provider_providerAccountId: { provider: providerCfg.id, providerAccountId } },
    include: { user: true },
  });
  if (identity) return identity.user.isActive ? identity.userId : null;

  const rawEmail = profile.email ?? profile.preferred_username ?? null;
  if (!rawEmail || !rawEmail.includes("@")) return null;
  if (profile.email_verified === false) return null;
  const email = normalizeEmail(rawEmail);
  const domain = email.split("@")[1]!;
  if (providerCfg.allowedDomains.length && !providerCfg.allowedDomains.map((d) => d.toLowerCase()).includes(domain)) {
    logger.warn({ provider: providerCfg.id, domain }, "OIDC sign-in rejected: domain not allowed");
    return null;
  }

  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    if (!providerCfg.autoProvision) return null;
    user = await provisionUser({ email, name: profile.name ?? email, roleKeys: [providerCfg.defaultRole] });
    await audit(systemActor("auth"), { action: "user.provisioned", entityType: "user", entityId: user.id, changes: { provider: providerCfg.id } });
  }
  if (!user.isActive) return null;
  await db.userIdentity.create({ data: { userId: user.id, provider: providerCfg.id, providerAccountId } });
  return user.id;
}

export function buildAuthConfig(): NextAuthConfig {
  const cfg = getConfig();
  const oidc = configuredOidcProviders(cfg);
  const providers: Provider[] = [];
  if (cfg.auth.local.enabled) {
    providers.push(
      Credentials({
        id: "credentials",
        name: "Email and password",
        credentials: { email: {}, password: {}, otp: {} },
        authorize: authorizeCredentials,
      }),
    );
  }
  providers.push(...oidc.map(buildOidcProvider));

  return {
    providers,
    session: { strategy: "jwt", maxAge: cfg.auth.sessionMaxAgeHours * 3600 },
    pages: { signIn: "/login", error: "/login" },
    trustHost: true,
    logger: {
      error: (error) => logger.error({ err: error }, "auth error"),
      warn: (code) => logger.warn({ code }, "auth warning"),
    },
    callbacks: {
      async signIn({ account, profile, user }) {
        if (!account || account.type === "credentials") return true;
        const providerCfg = oidc.find((p) => p.id === account.provider);
        if (!providerCfg) return false;
        const userId = await resolveOidcUser(providerCfg, account.providerAccountId, {
          email: (profile?.email as string | undefined) ?? user.email,
          name: (profile?.name as string | undefined) ?? user.name,
          email_verified: profile?.email_verified as boolean | undefined,
          preferred_username: profile?.preferred_username as string | undefined,
        });
        if (!userId) return "/login?error=AccessDenied";
        user.id = userId;
        await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
        await audit(systemActor("auth"), { action: "auth.login", entityType: "user", entityId: userId, changes: { method: account.provider } });
        return true;
      },
      async jwt({ token, user }) {
        if (user?.id) {
          const row = await db.user.findUnique({ where: { id: user.id }, select: { sessionVersion: true } });
          token.uid = user.id;
          token.sv = row?.sessionVersion ?? 0;
        }
        return token;
      },
      async session({ session, token }) {
        if (token.uid && session.user) {
          (session.user as { id?: string }).id = token.uid as string;
          (session as unknown as { sv: number }).sv = (token.sv as number) ?? 0;
        }
        return session;
      },
    },
  };
}

// Auth.js builds callback URLs and decides on secure cookies from AUTH_URL when
// set, and otherwise from proxy headers (X-Forwarded-Proto/Host). Pin it to the
// public URL so tunnels and proxies that don't send those headers still work.
process.env.AUTH_URL ??= process.env.APP_BASE_URL;

export const { handlers, auth, signIn, signOut } = NextAuth(() => buildAuthConfig());

/** Exposed for tests only. */
export const _authorizeCredentialsForTests = authorizeCredentials;
