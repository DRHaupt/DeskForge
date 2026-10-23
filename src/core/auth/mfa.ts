/**
 * Multi-factor detection for single sign-on users (pure helpers).
 *
 * Two independent signals, either of which counts:
 *  1. The sign-in itself used MFA: the `amr` (authentication methods) claim
 *     contains "mfa". Entra puts it in ID tokens and in Graph access tokens.
 *  2. An authenticator is registered with the identity provider (Microsoft
 *     Graph /me/authentication/methods), when that check is enabled.
 */

/** Decode a JWT's payload without verifying it. Only use on tokens received directly from the IdP's token endpoint. */
export function decodeJwtClaims(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function amrOf(claims: Record<string, unknown> | null | undefined): string[] {
  const amr = claims?.amr;
  return Array.isArray(amr) ? amr.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase()) : [];
}

/** True when any of the given claim sets (ID token profile, decoded tokens) says MFA was used. */
export function signInUsedMfa(...claimSets: (Record<string, unknown> | null | undefined)[]): boolean {
  return claimSets.some((c) => amrOf(c).includes("mfa"));
}

/** Graph authentication method types that are a real second factor. Password, email (SSPR only) and temporary access passes don't count. */
export const STRONG_METHOD_TYPES = new Set([
  "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod",
  "#microsoft.graph.phoneAuthenticationMethod",
  "#microsoft.graph.softwareOathAuthenticationMethod",
  "#microsoft.graph.fido2AuthenticationMethod",
  "#microsoft.graph.windowsHelloForBusinessAuthenticationMethod",
  "#microsoft.graph.platformCredentialAuthenticationMethod",
  "#microsoft.graph.hardwareOathAuthenticationMethod",
]);

export function hasStrongMethod(methods: unknown): boolean {
  if (!Array.isArray(methods)) return false;
  return methods.some((m) => typeof m === "object" && m !== null && STRONG_METHOD_TYPES.has(String((m as Record<string, unknown>)["@odata.type"])));
}

export type OnboardingStep = "signin" | "mfa" | "welcome";

/** Which step of /welcome to show. */
export function onboardingStep(s: { signedIn: boolean; requireMfa: boolean; mfaDone: boolean }): OnboardingStep {
  if (!s.signedIn) return "signin";
  if (s.requireMfa && !s.mfaDone) return "mfa";
  return "welcome";
}
