import { verifyTotpCode } from "@/core/auth/totp";
import { decryptSecret } from "./crypto";

/** Verify a code against an encrypted stored secret. */
export function verifyTotp(storedSecret: string, code: string): boolean {
  try {
    return verifyTotpCode(decryptSecret(storedSecret), code);
  } catch {
    return false;
  }
}
