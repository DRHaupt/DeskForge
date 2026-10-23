/**
 * Runs before every page request: sets a per-request CSP nonce and a request id,
 * and sends signed-out visitors of protected areas to the login page. Real
 * authorization happens server-side in pages and API routes; this is only a
 * fast redirect.
 */
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/agent", "/admin"];
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const hasSession = SESSION_COOKIES.some((c) => request.cookies.has(c));
    if (!hasSession) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?callbackUrl=${encodeURIComponent(pathname + search)}`;
      return NextResponse.redirect(url);
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const https = process.env.APP_BASE_URL?.startsWith("https://");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are used by UI primitives (positioning); scripts stay strict.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: [
    // Pages only: skip API routes (they set their own headers), static files and images.
    { source: "/((?!api|scim|_next/static|_next/image|branding|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }] },
  ],
};
