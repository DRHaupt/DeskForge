/** Public sign-up, password reset and invite links (local accounts). */
import { z } from "zod";
import { getConfig } from "@/core/config/loader";
import { checkPassword } from "@/core/auth/password";
import { assertCan, systemActor, type Actor } from "@/core/rbac/actor";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/core/errors";
import { audit, type AuditContext } from "../audit";
import { randomToken, sha256 } from "../crypto";
import { db } from "../db";
import { queueEmail } from "../mail/outbound";
import { appUrl } from "../mail/templates";
import { hashPassword } from "../passwords";
import { normalizeEmail, provisionUser } from "../users";

export const signupSchema = z.object({ name: z.string().trim().min(1).max(120), email: z.email().max(320), password: z.string().max(256) });

export async function signup(input: z.infer<typeof signupSchema>, ctx?: AuditContext) {
  const cfg = getConfig();
  if (!cfg.features.publicSignup || !cfg.auth.local.enabled) throw new ForbiddenError(undefined, "Sign-up is not available");
  const email = normalizeEmail(input.email);
  const problems = checkPassword(input.password, cfg.auth.local.passwordPolicy);
  if (problems.length) throw new ValidationError(`Password ${problems.join(", ")}`, { password: problems.join(", ") });
  if (await db.user.findUnique({ where: { email } })) throw new ConflictError("An account with this email already exists. Sign in, or reset your password.");
  const user = await provisionUser({ email, name: input.name, passwordHash: await hashPassword(input.password), roleKeys: ["requester"] });
  await audit(systemActor("signup"), { action: "user.signup", entityType: "user", entityId: user.id }, ctx);
  return { id: user.id };
}

async function issueToken(userId: string, purpose: "reset" | "invite", hours: number) {
  const token = randomToken(32);
  await db.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }); // one live token at a time
  await db.passwordResetToken.create({ data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * 3600_000) } });
  return token;
}

/** Always succeeds from the caller's point of view (no account enumeration). */
export async function requestPasswordReset(emailRaw: string, ctx?: AuditContext) {
  const cfg = getConfig();
  if (!cfg.auth.local.enabled) return { ok: true };
  const user = await db.user.findUnique({ where: { email: normalizeEmail(emailRaw) } });
  if (!user || !user.isActive) return { ok: true };
  const token = await issueToken(user.id, "reset", 1);
  await queueEmail({
    kind: "auth.password_reset",
    to: user.email,
    subject: `Reset your ${cfg.branding.name} password`,
    content: {
      heading: "Reset your password",
      paragraphs: [`Hi ${user.name.split(" ")[0]}, someone (hopefully you) asked to reset your password. The link works for one hour.`, "If you didn't ask for this, you can ignore this email."],
      button: { label: "Choose a new password", url: appUrl(`/reset-password?token=${token}`) },
    },
  });
  await audit(systemActor("auth"), { action: "auth.reset_requested", entityType: "user", entityId: user.id }, ctx);
  return { ok: true };
}

export async function sendInvite(actor: Actor, userId: string, ctx?: AuditContext) {
  assertCan(actor, "user.manage");
  const cfg = getConfig();
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) throw new NotFoundError("User");
  const token = await issueToken(user.id, "invite", 72);
  await queueEmail({
    kind: "auth.invite",
    to: user.email,
    subject: `You're invited to ${cfg.branding.name}`,
    content: {
      heading: `Welcome to ${cfg.branding.name}`,
      paragraphs: [`Hi ${user.name.split(" ")[0]}, an account has been created for you. Choose a password to get started — the link works for 3 days.`],
      button: { label: "Set your password", url: appUrl(`/reset-password?token=${token}`) },
    },
  });
  await audit(actor, { action: "user.invite", entityType: "user", entityId: user.id }, ctx);
  return { ok: true };
}

export const resetConfirmSchema = z.object({ token: z.string().min(20).max(200), password: z.string().max(256) });

export async function confirmPasswordReset(input: z.infer<typeof resetConfirmSchema>, ctx?: AuditContext) {
  const cfg = getConfig();
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(input.token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.isActive) throw new ValidationError("This link is invalid or has expired. Request a new one.");
  const problems = checkPassword(input.password, cfg.auth.local.passwordPolicy);
  if (problems.length) throw new ValidationError(`Password ${problems.join(", ")}`, { password: problems.join(", ") });
  await db.$transaction([
    db.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    db.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(input.password), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, sessionVersion: { increment: 1 } } }),
  ]);
  await audit(systemActor("auth"), { action: row.purpose === "invite" ? "auth.invite_accepted" : "auth.password_reset", entityType: "user", entityId: row.userId }, ctx);
  return { ok: true, email: row.user.email };
}
