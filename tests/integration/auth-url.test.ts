import { describe, expect, it, vi } from "vitest";

describe("Auth.js public URL", () => {
  it("uses APP_BASE_URL even when the proxy sends no X-Forwarded-Proto (e.g. a tunnel)", async () => {
    const prevBase = process.env.APP_BASE_URL;
    const prevAuth = process.env.AUTH_URL;
    process.env.APP_BASE_URL = "https://help.example.com";
    delete process.env.AUTH_URL;
    vi.resetModules();
    const { handlers } = await import("@/server/auth");
    const { NextRequest } = await import("next/server");
    // What a tunnel connector sends: plain http to the app, no forwarding headers.
    const res = await handlers.GET(new NextRequest("http://app:3000/api/auth/csrf", { headers: { host: "app:3000" } }));
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/__Host-authjs\.csrf-token=/);
    expect(cookie.toLowerCase()).toContain("secure");
    const providers = await (await handlers.GET(new NextRequest("http://app:3000/api/auth/providers", { headers: { host: "app:3000" } }))).json();
    expect(providers.credentials.callbackUrl).toBe("https://help.example.com/api/auth/callback/credentials");
    process.env.APP_BASE_URL = prevBase;
    if (prevAuth === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = prevAuth;
  });
});
