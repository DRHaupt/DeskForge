/** Request handling shared by the /scim/v2 endpoints: auth, rate limits, SCIM-format errors. */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getConfig } from "@/core/config/loader";
import { scimError, ScimError } from "@/core/scim/scim";
import type { AuditContext } from "./audit";
import { clientIpFrom } from "./client-ip";
import { logger } from "./logger";
import { rateLimit } from "./rate-limit";
import { verifyScimToken } from "./scim";

const CONTENT_TYPE = "application/scim+json";

export function scimJson(body: unknown, status = 200) {
  return new NextResponse(body === null ? null : JSON.stringify(body), { status, headers: body === null ? {} : { "content-type": CONTENT_TYPE } });
}

type Ctx = { req: NextRequest; audit: AuditContext; params: Record<string, string> };

export function scimRoute(handler: (ctx: Ctx) => Promise<Response>) {
  return async (req: NextRequest, routeCtx: { params: Promise<Record<string, string>> }): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const ip = clientIpFrom(req.headers);
    try {
      if (!getConfig().scim.enabled) throw new ScimError(404, "Provisioning is turned off (scim.enabled in business.config.yaml)");
      // Limit by IP before checking the token, so guessing tokens is slow.
      const rl = await rateLimit(`scim:${ip ?? "unknown"}`, Number(process.env.SCIM_RATE_LIMIT_PER_MINUTE ?? 600));
      if (!rl.allowed) {
        return NextResponse.json(scimError(429, "Too many requests"), { status: 429, headers: { "retry-after": String(rl.resetSeconds), "content-type": CONTENT_TYPE } });
      }
      if (!(await verifyScimToken(req.headers.get("authorization")))) throw new ScimError(401, "Invalid or missing provisioning token");
      return await handler({ req, audit: { ip, userAgent: req.headers.get("user-agent"), requestId }, params: await routeCtx.params });
    } catch (err) {
      if (err instanceof ScimError) return scimJson(scimError(err.status, err.message, err.scimType), err.status);
      logger.error({ err, requestId, path: req.nextUrl.pathname }, "SCIM request failed");
      return scimJson(scimError(500, `Internal error (request ${requestId})`), 500);
    }
  };
}

/** Parse a JSON body (application/json or application/scim+json). */
export async function scimBody(req: NextRequest): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (!/application\/(scim\+)?json/.test(type)) throw new ScimError(415, "Content-Type must be application/scim+json");
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ScimError(400, "Malformed JSON body", "invalidSyntax");
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new ScimError(400, "Expected a JSON object", "invalidSyntax");
  return json as Record<string, unknown>;
}
