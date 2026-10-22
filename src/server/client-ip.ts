/**
 * The visitor's IP address, for rate limits and audit logs.
 *
 * Default: the first X-Forwarded-For entry, as set by the reverse proxy
 * (Caddy and the Nginx example only pass on entries from trusted proxies).
 * Set CLIENT_IP_HEADER (e.g. "cf-connecting-ip") when the app is reachable only
 * through a proxy that sets that header, such as a Cloudflare Tunnel. Never set
 * it when clients can reach the app directly, because they could forge it.
 */
import { getEnv } from "./env";

export function clientIpFrom(headers: Headers): string | null {
  const custom = getEnv().CLIENT_IP_HEADER;
  if (custom) {
    const v = headers.get(custom)?.split(",")[0]?.trim();
    if (v) return v;
  }
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
}
