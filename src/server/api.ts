/**
 * Wrapper for every API route handler. It:
 * - authenticates (session cookie or `Authorization: Bearer <api key>`)
 * - checks the required permission (server-side, always)
 * - checks Origin on cookie-authenticated mutations (CSRF)
 * - rate-limits per actor / IP
 * - validates params, query and JSON body with Zod
 * - writes an audit entry for successful mutations
 * - maps domain errors to JSON responses with a request id
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ForbiddenError, type Actor } from "@/core/rbac/actor";
import { can } from "@/core/rbac/actor";
import type { Permission } from "@/core/rbac/permissions";
import { ConflictError, NotFoundError, ValidationError } from "@/core/errors";
import { ConfigError } from "@/core/config/loader";
import { audit, type AuditContext } from "./audit";
import { authenticateApiKey } from "./api-keys";
import { getCurrentActor } from "./session";
import { logger } from "./logger";
import { rateLimit } from "./rate-limit";
import { randomUUID } from "node:crypto";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

type Schemas = { body?: z.ZodType; query?: z.ZodType; params?: z.ZodType };
type Infer<S, K extends keyof Schemas> = S extends { [P in K]: infer T } ? (T extends z.ZodType ? z.output<T> : undefined) : undefined;

export type ApiContext<S extends Schemas> = {
  req: NextRequest;
  actor: Actor;
  body: Infer<S, "body">;
  query: Infer<S, "query">;
  params: Infer<S, "params">;
  /** Signed-in caller or null (only meaningful with `optionalAuth`). Never a privileged stand-in. */
  viewer: Actor | null;
  audit: AuditContext;
  requestId: string;
  /** Record an audit entry (in addition to the automatic one). */
  record: (entry: { action: string; entityType: string; entityId?: string | null; changes?: unknown }) => Promise<void>;
};

export type ApiOptions<S extends Schemas> = S & {
  /** Required permission(s). Any one of an array is enough. Omit only with `public: true` or `authOnly: true`. */
  permission?: Permission | Permission[];
  /** No authentication at all (health checks, inbound webhooks with their own auth). */
  public?: boolean;
  /** Public, but resolve the caller if signed in / using an API key: `ctx.viewer` is the actor or null. */
  optionalAuth?: boolean;
  /** Any signed-in actor; the handler checks finer permissions itself. */
  authOnly?: boolean;
  /** Audit action name for mutations, e.g. "user.update". Defaults to METHOD + path. */
  auditAction?: string;
  /** Requests per minute for this route (per actor or IP). */
  rateLimit?: number;
  /** The service writes its own, richer audit entry; don't add the generic one. */
  skipAudit?: boolean;
  /** HTTP status for success. Defaults to 201 for POST (creates) and 200 otherwise; use 200 for POST actions. */
  status?: number;
};

type RouteCtx = { params: Promise<Record<string, string | string[]>> };

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const base = process.env.APP_BASE_URL;
  if (!origin) {
    // Browsers always send Origin on cross-site POSTs; fall back to Sec-Fetch-Site.
    const site = req.headers.get("sec-fetch-site");
    return !site || site === "same-origin" || site === "none";
  }
  const allowed = new Set<string>([req.nextUrl.origin]);
  if (base) allowed.add(new URL(base).origin);
  return allowed.has(origin);
}

function errorResponse(err: unknown, requestId: string): NextResponse {
  const headers = { "x-request-id": requestId };
  if (err instanceof HttpError) return NextResponse.json({ error: err.message, details: err.details, requestId }, { status: err.status, headers });
  if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message, requestId }, { status: 403, headers });
  if (err instanceof NotFoundError) return NextResponse.json({ error: err.message, requestId }, { status: 404, headers });
  if (err instanceof ValidationError) return NextResponse.json({ error: err.message, fields: err.fields, requestId }, { status: 400, headers });
  if (err instanceof ConflictError) return NextResponse.json({ error: err.message, requestId }, { status: 409, headers });
  if (err instanceof z.ZodError)
    return NextResponse.json({ error: "Validation failed", issues: z.flattenError(err), requestId }, { status: 400, headers });
  // Any other domain error that carries a 4xx status (e.g. WorkflowError).
  const status = (err as { status?: unknown })?.status;
  if (err instanceof Error && typeof status === "number" && status >= 400 && status < 500) {
    return NextResponse.json({ error: err.message, requestId }, { status, headers });
  }
  if (err instanceof ConfigError) {
    logger.error({ err, requestId }, "configuration error");
    return NextResponse.json({ error: "Server configuration error", requestId }, { status: 500, headers });
  }
  const prismaCode = (err as { code?: string })?.code;
  if (prismaCode === "P2002") return NextResponse.json({ error: "Already exists", requestId }, { status: 409, headers });
  if (prismaCode === "P2025") return NextResponse.json({ error: "Not found", requestId }, { status: 404, headers });
  logger.error({ err, requestId }, "unhandled API error");
  if (process.env.DEBUG_TEST_LOGS) console.error("unhandled API error", err);
  return NextResponse.json({ error: "Internal server error", requestId }, { status: 500, headers });
}

export function apiRoute<S extends Schemas>(opts: ApiOptions<S>, handler: (ctx: ApiContext<S>) => Promise<unknown>) {
  if (!opts.public && !opts.authOnly && !opts.permission) {
    throw new Error("apiRoute: set `permission`, `authOnly` or `public`");
  }
  return async (req: NextRequest, routeCtx: RouteCtx): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    const started = Date.now();
    const ip = clientIp(req);
    const auditCtx: AuditContext = { ip, userAgent: req.headers.get("user-agent"), requestId };
    try {
      // 1. Authenticate
      let actor = null as Actor | null;
      let viaApiKey = false;
      if (!opts.public || opts.optionalAuth) {
        const authz = req.headers.get("authorization");
        if (authz?.startsWith("Bearer ")) {
          actor = await authenticateApiKey(authz.slice(7).trim());
          viaApiKey = true;
          if (!actor) throw new HttpError(401, "Invalid API key");
        } else {
          actor = await getCurrentActor();
        }
        if (!actor && !opts.optionalAuth) throw new HttpError(401, "Authentication required");
      }

      // 2. CSRF: cookie-authenticated mutations must come from our own origin.
      if (MUTATING.has(req.method) && !viaApiKey && !opts.public && !sameOrigin(req)) {
        throw new HttpError(403, "Cross-origin request rejected");
      }

      // 3. Rate limit
      const limit = opts.rateLimit ?? Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300);
      const rlKey = actor && "id" in actor ? `${actor.kind}:${actor.id}` : `ip:${ip}`;
      const rl = await rateLimit(`${rlKey}:${opts.rateLimit ? req.nextUrl.pathname : "global"}`, limit);
      if (!rl.allowed) {
        return NextResponse.json(
          { error: "Too many requests", requestId },
          { status: 429, headers: { "retry-after": String(rl.resetSeconds), "x-request-id": requestId } },
        );
      }

      // 4. Authorize
      if (opts.permission && actor) {
        const perms = Array.isArray(opts.permission) ? opts.permission : [opts.permission];
        if (!perms.some((p) => can(actor!, p))) throw new ForbiddenError(perms.join(" | "));
      }

      // 5. Validate input
      const rawParams = await routeCtx.params;
      const params = opts.params ? opts.params.parse(rawParams) : undefined;
      const query = opts.query ? opts.query.parse(Object.fromEntries(req.nextUrl.searchParams)) : undefined;
      let body: unknown;
      if (opts.body) {
        const contentType = req.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) throw new HttpError(415, "Content-Type must be application/json");
        let json: unknown;
        try {
          json = await req.json();
        } catch {
          throw new HttpError(400, "Malformed JSON body");
        }
        body = opts.body.parse(json);
      }

      const ctx: ApiContext<S> = {
        req,
        // Public routes get a permissionless placeholder; use `viewer` for the real caller.
        actor: actor ?? { kind: "user", id: "", email: "", name: "anonymous", roles: [], permissions: new Set(), organizationId: null, orgTicketAccess: false, teamIds: [] },
        viewer: actor,
        body: body as Infer<S, "body">,
        query: query as Infer<S, "query">,
        params: params as Infer<S, "params">,
        audit: auditCtx,
        requestId,
        record: (entry) => audit(ctx.actor, entry, auditCtx),
      };

      const result = await handler(ctx);

      // 6. Audit successful mutations
      if (MUTATING.has(req.method) && actor && !opts.public && !opts.skipAudit) {
        const entityId = typeof rawParams?.id === "string" ? rawParams.id : (result as { id?: string } | null)?.id;
        await audit(
          actor,
          {
            action: opts.auditAction ?? `${req.method} ${req.nextUrl.pathname}`,
            entityType: opts.auditAction?.split(".")[0] ?? "api",
            entityId: entityId ?? null,
            changes: body && typeof body === "object" ? redactBody(body as Record<string, unknown>) : undefined,
          },
          auditCtx,
        );
      }

      logger.info({ requestId, method: req.method, path: req.nextUrl.pathname, ms: Date.now() - started, actor: actor && "id" in actor ? actor.id : null }, "api request");
      if (result instanceof Response) {
        result.headers.set("x-request-id", requestId);
        return result;
      }
      return NextResponse.json(result ?? { ok: true }, { status: opts.status ?? (req.method === "POST" ? 201 : 200), headers: { "x-request-id": requestId } });
    } catch (err) {
      const res = errorResponse(err, requestId);
      if (res.status >= 500) logger.error({ requestId, path: req.nextUrl.pathname, status: res.status }, "api error");
      return res;
    }
  };
}

function redactBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) out[k] = /password|secret|token|otp/i.test(k) ? "[redacted]" : v;
  return out;
}

/** Common param schema for /[id] routes. */
export const idParams = z.object({ id: z.string().min(1).max(64) });

/** Standard pagination query. */
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().max(200).optional(),
});
