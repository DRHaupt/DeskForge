/**
 * TOTP two-factor enrolment for local accounts. The secret is generated on
 * the server, stored encrypted and only turned on once the user proves their
 * authenticator app produces valid codes.
 */
import QRCode from "qrcode";
import { z } from "zod";
import { getConfig } from "@/core/config/loader";
import { generateTotpSecret, otpauthUrl, verifyTotpCode } from "@/core/auth/totp";
import { ConflictError, ValidationError } from "@/core/errors";
import type { UserActor } from "@/core/rbac/actor";
import { audit, type AuditContext } from "../audit";
import { decryptSecret, encryptSecret } from "../crypto";
import { db } from "../db";
import { verifyPassword } from "../passwords";

export async function twoFactorStatus(actor: UserActor) {
  const u = await db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { totpEnabled: true, passwordHash: true } });
  return { enabled: u.totpEnabled, hasPassword: Boolean(u.passwordHash), required: getConfig().auth.requireTwoFactorForRoles.some((r) => actor.roles.includes(r)) };
}

/** Start (or restart) enrolment: returns the secret and a QR code for the authenticator app. */
export async function beginEnrollment(actor: UserActor) {
  const u = await db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { totpEnabled: true, passwordHash: true, email: true } });
  if (u.totpEnabled) throw new ConflictError("Two-factor authentication is already on");
  if (!u.passwordHash) throw new ValidationError("Two-factor codes are for password sign-in. Your account signs in with single sign-on.");
  const secret = generateTotpSecret();
  await db.user.update({ where: { id: actor.id }, data: { totpSecret: encryptSecret(secret) } });
  const url = otpauthUrl(secret, u.email, getConfig().branding.name);
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { secret, otpauthUrl: url, qrSvg };
}

export const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") });

export async function confirmEnrollment(actor: UserActor, input: z.infer<typeof codeSchema>, ctx?: AuditContext) {
  const u = await db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { totpEnabled: true, totpSecret: true } });
  if (u.totpEnabled) throw new ConflictError("Two-factor authentication is already on");
  if (!u.totpSecret) throw new ValidationError("Start setup first");
  if (!verifyTotpCode(decryptSecret(u.totpSecret), input.code)) throw new ValidationError("That code didn't match. Check your phone's clock and try the newest code.", { code: "invalid" });
  await db.user.update({ where: { id: actor.id }, data: { totpEnabled: true, mfaVerifiedAt: new Date(), mfaVerifiedVia: "app" } });
  await audit(actor, { action: "auth.2fa_enabled", entityType: "user", entityId: actor.id }, ctx);
  return { enabled: true };
}

export const disableSchema = z.object({ password: z.string().min(1).max(200), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") });

export async function disableTwoFactor(actor: UserActor, input: z.infer<typeof disableSchema>, ctx?: AuditContext) {
  if (getConfig().auth.requireTwoFactorForRoles.some((r) => actor.roles.includes(r))) {
    throw new ValidationError("Your role requires two-factor authentication. Ask an administrator to reset it if you've lost your device.");
  }
  const u = await db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { totpEnabled: true, totpSecret: true, passwordHash: true } });
  if (!u.totpEnabled || !u.totpSecret) throw new ConflictError("Two-factor authentication is already off");
  if (!u.passwordHash || !(await verifyPassword(input.password, u.passwordHash))) throw new ValidationError("Wrong password", { password: "invalid" });
  if (!verifyTotpCode(decryptSecret(u.totpSecret), input.code)) throw new ValidationError("That code didn't match", { code: "invalid" });
  await db.user.update({ where: { id: actor.id }, data: { totpEnabled: false, totpSecret: null } });
  await audit(actor, { action: "auth.2fa_disabled", entityType: "user", entityId: actor.id }, ctx);
  return { enabled: false };
}
