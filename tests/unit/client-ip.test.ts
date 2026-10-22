import { afterEach, describe, expect, it } from "vitest";
import { getEnv } from "@/server/env";
import { clientIpFrom } from "@/server/client-ip";

const env = getEnv() as { CLIENT_IP_HEADER?: string };
afterEach(() => {
  env.CLIENT_IP_HEADER = undefined;
});

describe("clientIpFrom", () => {
  it("uses the first X-Forwarded-For entry by default", () => {
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "6.6.6.6, 172.68.1.1" }))).toBe("6.6.6.6");
    expect(clientIpFrom(new Headers({ "x-real-ip": "7.7.7.7" }))).toBe("7.7.7.7");
    expect(clientIpFrom(new Headers())).toBeNull();
  });
  it("ignores CF-Connecting-IP unless configured", () => {
    const h = new Headers({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "172.68.1.1" });
    expect(clientIpFrom(h)).toBe("172.68.1.1");
    env.CLIENT_IP_HEADER = "cf-connecting-ip";
    expect(clientIpFrom(h)).toBe("9.9.9.9");
    // Falls back when the configured header is missing.
    expect(clientIpFrom(new Headers({ "x-forwarded-for": "5.5.5.5" }))).toBe("5.5.5.5");
  });
});
