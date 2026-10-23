import { describe, expect, it } from "vitest";
import { decodeJwtClaims, hasStrongMethod, onboardingStep, signInUsedMfa } from "@/core/auth/mfa";

const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

describe("MFA detection", () => {
  it("reads amr from ID token claims or raw tokens", () => {
    expect(signInUsedMfa({ amr: ["pwd", "mfa"] })).toBe(true);
    expect(signInUsedMfa({ amr: ["pwd"] }, decodeJwtClaims(jwt({ amr: ["pwd", "rsa"] })))).toBe(false);
    expect(signInUsedMfa({ email: "a@b.c" }, decodeJwtClaims(jwt({ amr: ["MFA"] })))).toBe(true);
    expect(signInUsedMfa(undefined, null, decodeJwtClaims("not-a-jwt"))).toBe(false);
  });
  it("counts only real second factors from Graph", () => {
    expect(hasStrongMethod([{ "@odata.type": "#microsoft.graph.passwordAuthenticationMethod" }])).toBe(false);
    expect(hasStrongMethod([{ "@odata.type": "#microsoft.graph.emailAuthenticationMethod" }, { "@odata.type": "#microsoft.graph.temporaryAccessPassAuthenticationMethod" }])).toBe(false);
    expect(hasStrongMethod([{ "@odata.type": "#microsoft.graph.passwordAuthenticationMethod" }, { "@odata.type": "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod" }])).toBe(true);
    expect(hasStrongMethod(null)).toBe(false);
  });
  it("picks the onboarding step", () => {
    expect(onboardingStep({ signedIn: false, requireMfa: true, mfaDone: false })).toBe("signin");
    expect(onboardingStep({ signedIn: true, requireMfa: true, mfaDone: false })).toBe("mfa");
    expect(onboardingStep({ signedIn: true, requireMfa: true, mfaDone: true })).toBe("welcome");
    expect(onboardingStep({ signedIn: true, requireMfa: false, mfaDone: false })).toBe("welcome");
  });
});
