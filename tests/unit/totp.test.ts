import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, totpCode, verifyTotpCode } from "@/core/auth/totp";

describe("totp", () => {
  // RFC 6238 test vector: secret "12345678901234567890", T=59s → 94287082 (8 digits) → 287082 (6 digits)
  const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the RFC 6238 test vector", () => {
    expect(totpCode(rfcSecret, 59_000)).toBe("287082");
    expect(totpCode(rfcSecret, 1111111109_000)).toBe("081804");
  });
  it("round-trips base32", () => {
    const buf = Buffer.from("hello world!");
    expect(base32Decode(base32Encode(buf)).toString()).toBe("hello world!");
  });
  it("verifies within the drift window only", () => {
    const s = generateTotpSecret();
    const now = 1_800_000_000_000;
    expect(verifyTotpCode(s, totpCode(s, now), now)).toBe(true);
    expect(verifyTotpCode(s, totpCode(s, now - 30_000), now)).toBe(true);
    expect(verifyTotpCode(s, totpCode(s, now - 120_000), now)).toBe(false);
    expect(verifyTotpCode(s, "abc", now)).toBe(false);
  });
});
