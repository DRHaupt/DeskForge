/**
 * OpenAPI 3.1 document for /api/v1, generated from the same Zod schemas the
 * routes validate with, so the docs can't drift from the implementation.
 * Served at /api/v1/openapi.json and rendered at /api-docs.
 */
import { z } from "zod";
import { getConfig } from "@/core/config/loader";
import { automationInputSchema } from "@/core/automation/rules";
import pkg from "../../package.json";
import { pageQuery } from "./api";
import { articleListSchema, articleSchema, feedbackSchema, kbCategorySchema } from "./services/kb";
import { catalogItemSchema, catalogRequestSchema, decisionSchema } from "./services/catalog";
import { apiKeySchema } from "./services/api-key-admin";
import { cannedSchema } from "./services/canned";
import { createUserSchema, organizationSchema, roleSchema, teamMembersSchema, teamSchema, updateRoleSchema, updateTeamSchema, updateUserSchema } from "./services/admin";
import { assignSchema, bulkSchema, commentSchema, createTicketSchema, linkSchema, ticketFilterSchema, transitionSchema, updateTicketSchema, watchersSchema } from "./services/tickets";
import { viewSchema } from "./services/views";
import { webhookSchema } from "./webhooks";
import { assetFilterSchema, assetInputSchema, importSchema } from "./services/assets";
import { boardFilterSchema, moveSchema } from "./services/boards";
import { knownErrorFilter, raiseProblemSchema } from "./services/problems";
import { reportFilterSchema } from "./services/reports";
import { codeSchema, disableSchema } from "./services/two-factor";
import { markReadSchema } from "./services/notifications";
import { csatAnswerSchema } from "./services/csat";

type Endpoint = {
  method: "get" | "post" | "patch" | "put" | "delete";
  path: string;
  tag: string;
  summary: string;
  /** Permission(s) required; "public" = no auth; "signed-in" = any authenticated caller. */
  permission: string | string[];
  query?: z.ZodType;
  body?: z.ZodType;
  status?: number;
};


export const ENDPOINTS: Endpoint[] = [
  // Tickets
  { method: "get", path: "/tickets", tag: "Tickets", summary: "List tickets visible to the caller", permission: ["ticket.view_own", "ticket.view_team", "ticket.view_all", "ticket.view_org"], query: ticketFilterSchema },
  { method: "post", path: "/tickets", tag: "Tickets", summary: "Create a ticket", permission: "ticket.create", body: createTicketSchema, status: 201 },
  { method: "get", path: "/tickets/{id}", tag: "Tickets", summary: "Get a ticket by id or number (e.g. INC0001042)", permission: "signed-in" },
  { method: "patch", path: "/tickets/{id}", tag: "Tickets", summary: "Update fields, priority, tags, custom fields", permission: "ticket.update", body: updateTicketSchema },
  { method: "delete", path: "/tickets/{id}", tag: "Tickets", summary: "Soft-delete a ticket", permission: "ticket.delete" },
  { method: "get", path: "/tickets/{id}/timeline", tag: "Tickets", summary: "Comments, status changes and activity", permission: "signed-in" },
  { method: "post", path: "/tickets/{id}/transition", tag: "Tickets", summary: "Change status (workflow rules apply)", permission: "signed-in", body: transitionSchema },
  { method: "post", path: "/tickets/{id}/comments", tag: "Tickets", summary: "Add a public reply or internal note", permission: ["ticket.reply", "ticket.comment_internal"], body: commentSchema, status: 201 },
  { method: "post", path: "/tickets/{id}/assign", tag: "Tickets", summary: "Change team and/or assignee", permission: ["ticket.assign", "ticket.reassign"], body: assignSchema },
  { method: "post", path: "/tickets/{id}/watchers", tag: "Tickets", summary: "Add/remove watchers and CC emails", permission: "signed-in", body: watchersSchema },
  { method: "post", path: "/tickets/{id}/links", tag: "Tickets", summary: "Link to another ticket or an asset", permission: "ticket.link", body: linkSchema, status: 201 },
  { method: "delete", path: "/tickets/{id}/links/{linkId}", tag: "Tickets", summary: "Remove a link", permission: "ticket.link" },
  { method: "post", path: "/tickets/{id}/merge", tag: "Tickets", summary: "Merge this ticket into another", permission: "ticket.link", body: z.object({ target: z.string() }) },
  { method: "post", path: "/tickets/{id}/sla", tag: "Tickets", summary: "Override an SLA due date", permission: "sla.override", body: z.object({ metric: z.enum(["FIRST_RESPONSE", "RESOLUTION"]), dueAt: z.iso.datetime(), reason: z.string() }) },
  { method: "post", path: "/tickets/{id}/macro", tag: "Tickets", summary: "Apply a macro's actions", permission: "ticket.update", body: z.object({ cannedId: z.string() }) },
  { method: "post", path: "/tickets/bulk", tag: "Tickets", summary: "Bulk update (per-ticket results)", permission: "ticket.bulk", body: bulkSchema },
  { method: "delete", path: "/comments/{id}", tag: "Tickets", summary: "Delete your comment", permission: "signed-in" },
  { method: "post", path: "/tickets/{id}/problem", tag: "ITSM", summary: "Raise a problem from this incident and link them", permission: "problem.manage", body: raiseProblemSchema, status: 201 },
  { method: "get", path: "/known-errors", tag: "ITSM", summary: "Known errors with workarounds", permission: "ticket.comment_internal", query: knownErrorFilter },
  { method: "get", path: "/assets", tag: "ITSM", summary: "List and filter assets", permission: "asset.view", query: assetFilterSchema },
  { method: "post", path: "/assets", tag: "ITSM", summary: "Create an asset", permission: "asset.manage", body: assetInputSchema, status: 201 },
  { method: "get", path: "/assets/{id}", tag: "ITSM", summary: "Get an asset (by id or tag) with linked tickets", permission: "asset.view" },
  { method: "patch", path: "/assets/{id}", tag: "ITSM", summary: "Update an asset", permission: "asset.manage", body: assetInputSchema.partial() },
  { method: "delete", path: "/assets/{id}", tag: "ITSM", summary: "Delete (soft) an asset", permission: "asset.manage" },
  { method: "post", path: "/assets/import", tag: "ITSM", summary: "Import or update assets from CSV text (matched by tag); dryRun previews", permission: "asset.manage", body: importSchema },
  { method: "get", path: "/assets/export", tag: "ITSM", summary: "Export assets as CSV", permission: "asset.view", query: assetFilterSchema.partial() },
  { method: "get", path: "/boards", tag: "ITSM", summary: "Agile boards defined in the business config", permission: ["ticket.view_team", "ticket.view_all"] },
  { method: "get", path: "/boards/{key}", tag: "ITSM", summary: "Board columns and cards", permission: ["ticket.view_team", "ticket.view_all"], query: boardFilterSchema },
  { method: "post", path: "/boards/{key}/move", tag: "ITSM", summary: "Move a card (transitions the ticket if the column changes)", permission: "ticket.update", body: moveSchema },
  { method: "get", path: "/reports", tag: "Reports", summary: "Volumes, response/resolution times, SLA compliance, backlog, agents and CSAT for a period", permission: "report.view", query: reportFilterSchema },
  { method: "get", path: "/reports/export/{kind}", tag: "Reports", summary: "CSV export: tickets, summary (daily), agents or sla", permission: "report.export", query: reportFilterSchema },
  { method: "get", path: "/me/two-factor", tag: "Me", summary: "Two-factor status", permission: "signed-in" },
  { method: "post", path: "/me/two-factor", tag: "Me", summary: "Start two-factor enrolment (returns secret and QR code)", permission: "signed-in" },
  { method: "post", path: "/me/two-factor/confirm", tag: "Me", summary: "Confirm enrolment with a current code", permission: "signed-in", body: codeSchema },
  { method: "post", path: "/me/two-factor/disable", tag: "Me", summary: "Turn two-factor off (password and code)", permission: "signed-in", body: disableSchema },
  { method: "get", path: "/me/onboarding", tag: "Me", summary: "Your onboarding step (sign in → MFA → welcome)", permission: "signed-in" },
  { method: "post", path: "/me/onboarding", tag: "Me", summary: "Finish onboarding (after MFA); returns where to go next", permission: "signed-in" },
  { method: "post", path: "/users/{id}/welcome", tag: "Administration", summary: "Email a user their onboarding link (/welcome); also returns the link", permission: "user.manage" },
  { method: "get", path: "/me/assets", tag: "Me", summary: "Assets assigned to you", permission: "signed-in" },
  { method: "post", path: "/attachments", tag: "Attachments", summary: "Upload a file (multipart/form-data, field 'file'); reference the returned id when posting", permission: ["ticket.create", "ticket.reply", "ticket.comment_internal", "kb.author"], status: 201 },
  { method: "get", path: "/attachments/{id}", tag: "Attachments", summary: "Download an attachment you can see", permission: "signed-in" },
  { method: "get", path: "/search", tag: "Tickets", summary: "Full-text search across tickets, comments and articles", permission: "signed-in", query: z.object({ q: z.string(), kind: z.enum(["all", "tickets", "articles"]).optional(), limit: z.number().optional() }) },
  { method: "get", path: "/views", tag: "Tickets", summary: "Saved views (own + shared)", permission: "signed-in" },
  { method: "post", path: "/views", tag: "Tickets", summary: "Save a view", permission: "ticket.view_own", body: viewSchema, status: 201 },
  { method: "get", path: "/meta", tag: "Tickets", summary: "Ticket types, fields, workflows, priorities, categories", permission: "signed-in" },
  // Knowledge base
  { method: "get", path: "/kb/articles", tag: "Knowledge base", summary: "List articles (public ones without auth)", permission: "public", query: articleListSchema },
  { method: "post", path: "/kb/articles", tag: "Knowledge base", summary: "Create an article", permission: "kb.author", body: articleSchema, status: 201 },
  { method: "get", path: "/kb/articles/{id}", tag: "Knowledge base", summary: "Get an article by id or slug", permission: "public" },
  { method: "patch", path: "/kb/articles/{id}", tag: "Knowledge base", summary: "Update / publish / archive", permission: "kb.author", body: articleSchema.partial() },
  { method: "post", path: "/kb/articles/{id}/feedback", tag: "Knowledge base", summary: "Was this helpful?", permission: "public", body: feedbackSchema },
  { method: "get", path: "/kb/categories", tag: "Knowledge base", summary: "Categories", permission: "public" },
  { method: "post", path: "/kb/categories", tag: "Knowledge base", summary: "Create category", permission: "kb.publish", body: kbCategorySchema, status: 201 },
  { method: "get", path: "/kb/suggest", tag: "Knowledge base", summary: "Suggested articles for free text", permission: "public", query: z.object({ q: z.string(), limit: z.number().optional() }) },
  // Catalog
  { method: "get", path: "/catalog/items", tag: "Service catalog", summary: "Requestable items", permission: "catalog.request" },
  { method: "post", path: "/catalog/items", tag: "Service catalog", summary: "Create item", permission: "catalog.manage", body: catalogItemSchema, status: 201 },
  { method: "patch", path: "/catalog/items/{id}", tag: "Service catalog", summary: "Update item", permission: "catalog.manage", body: catalogItemSchema.partial() },
  { method: "post", path: "/catalog/items/{id}/request", tag: "Service catalog", summary: "Request an item (creates a ticket)", permission: "catalog.request", body: catalogRequestSchema, status: 201 },
  { method: "get", path: "/approvals", tag: "Service catalog", summary: "Approvals assigned to the caller", permission: "signed-in" },
  { method: "post", path: "/approvals/{id}", tag: "Service catalog", summary: "Approve or reject", permission: "signed-in", body: decisionSchema },
  { method: "post", path: "/csat/{token}", tag: "Service catalog", summary: "Answer a satisfaction survey (token from email)", permission: "public", body: csatAnswerSchema },
  // Notifications & profile
  { method: "get", path: "/notifications", tag: "Me", summary: "In-app notifications", permission: "signed-in" },
  { method: "post", path: "/notifications", tag: "Me", summary: "Mark notifications read", permission: "signed-in", body: markReadSchema },
  { method: "get", path: "/me", tag: "Me", summary: "Current user, roles and permissions", permission: "signed-in" },
  // Admin
  { method: "get", path: "/users", tag: "Administration", summary: "List users", permission: "user.view", query: pageQuery },
  { method: "post", path: "/users", tag: "Administration", summary: "Create user", permission: "user.manage", body: createUserSchema, status: 201 },
  { method: "patch", path: "/users/{id}", tag: "Administration", summary: "Update user / roles / deactivate", permission: "user.manage", body: updateUserSchema },
  { method: "get", path: "/roles", tag: "Administration", summary: "Roles", permission: ["role.manage", "user.view"] },
  { method: "post", path: "/roles", tag: "Administration", summary: "Create role", permission: "role.manage", body: roleSchema, status: 201 },
  { method: "patch", path: "/roles/{id}", tag: "Administration", summary: "Update role permissions", permission: "role.manage", body: updateRoleSchema },
  { method: "get", path: "/teams", tag: "Administration", summary: "Teams", permission: ["team.manage", "ticket.view_team"] },
  { method: "post", path: "/teams", tag: "Administration", summary: "Create team", permission: "team.manage", body: teamSchema, status: 201 },
  { method: "patch", path: "/teams/{id}", tag: "Administration", summary: "Update team", permission: "team.manage", body: updateTeamSchema },
  { method: "put", path: "/teams/{id}/members", tag: "Administration", summary: "Replace team members", permission: "team.manage", body: teamMembersSchema },
  { method: "get", path: "/organizations", tag: "Administration", summary: "Organizations", permission: "org.view" },
  { method: "post", path: "/organizations", tag: "Administration", summary: "Create organization", permission: "org.manage", body: organizationSchema, status: 201 },
  { method: "get", path: "/audit-logs", tag: "Administration", summary: "Audit log", permission: "audit.view", query: pageQuery },
  // Integrations
  { method: "get", path: "/automations", tag: "Integrations", summary: "Automations", permission: "automation.manage" },
  { method: "post", path: "/automations", tag: "Integrations", summary: "Create automation", permission: "automation.manage", body: automationInputSchema, status: 201 },
  { method: "patch", path: "/automations/{id}", tag: "Integrations", summary: "Update automation", permission: "automation.manage", body: automationInputSchema.partial() },
  { method: "get", path: "/webhooks", tag: "Integrations", summary: "Webhooks and recent deliveries", permission: "webhook.manage" },
  { method: "post", path: "/webhooks", tag: "Integrations", summary: "Create webhook (returns the signing secret once)", permission: "webhook.manage", body: webhookSchema, status: 201 },
  { method: "post", path: "/webhooks/{id}/test", tag: "Integrations", summary: "Send a test delivery", permission: "webhook.manage" },
  { method: "get", path: "/api-keys", tag: "Integrations", summary: "API keys", permission: "apikey.manage" },
  { method: "post", path: "/api-keys", tag: "Integrations", summary: "Create API key (returned once)", permission: "apikey.manage", body: apiKeySchema, status: 201 },
  { method: "delete", path: "/api-keys/{id}", tag: "Integrations", summary: "Revoke API key", permission: "apikey.manage" },
  { method: "post", path: "/provisioning/token", tag: "Integrations", summary: "Create or replace the SCIM provisioning token (returned once)", permission: "user.manage", status: 201 },
  { method: "delete", path: "/provisioning/token", tag: "Integrations", summary: "Revoke the SCIM provisioning token", permission: "user.manage" },
  { method: "get", path: "/canned", tag: "Integrations", summary: "Canned responses & macros", permission: "ticket.reply" },
  { method: "post", path: "/canned", tag: "Integrations", summary: "Create canned response", permission: "ticket.reply", body: cannedSchema, status: 201 },
];

function jsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any", target: "draft-2020-12" }) as Record<string, unknown>;
}

function queryParams(schema: z.ZodType) {
  const s = jsonSchema(schema) as { properties?: Record<string, unknown>; required?: string[] };
  return Object.entries(s.properties ?? {}).map(([name, sch]) => ({ name, in: "query", required: s.required?.includes(name) ?? false, schema: sch }));
}

export function buildOpenApi() {
  const cfg = getConfig();
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    const pathParams = [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    const perms = Array.isArray(e.permission) ? e.permission : [e.permission];
    const op: Record<string, unknown> = {
      tags: [e.tag],
      summary: e.summary,
      description: perms[0] === "public" ? "No authentication required." : perms[0] === "signed-in" ? "Any authenticated caller; finer checks apply to the resource." : `Requires permission: ${perms.join(" or ")}.`,
      "x-permission": perms,
      parameters: [...pathParams, ...(e.query ? queryParams(e.query) : [])],
      responses: {
        [String(e.status ?? 200)]: { description: "Success" },
        "400": { description: "Validation failed", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        ...(perms[0] !== "public" ? { "401": { description: "Not authenticated" }, "403": { description: "Missing permission" } } : {}),
        "404": { description: "Not found (or not visible to you)" },
        "429": { description: "Rate limited" },
      },
      ...(perms[0] === "public" ? { security: [] } : {}),
    };
    if (e.body) op.requestBody = { required: true, content: { "application/json": { schema: jsonSchema(e.body) } } };
    if (e.path === "/attachments" && e.method === "post") {
      op.requestBody = { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } } } };
    }
    (paths[e.path] ??= {})[e.method] = op;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: `${cfg.branding.name} API`,
      version: pkg.version,
      description:
        "DeskForge REST API v1. Authenticate with an Authorization: Bearer dfk_… header (create keys under Administration → API keys). A key's permissions are its scopes intersected with its creator's current permissions. All requests and responses are JSON unless noted.",
    },
    servers: [{ url: `${(process.env.APP_BASE_URL ?? "").replace(/\/$/, "")}/api/v1` }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", bearerFormat: "dfk_<prefix>_<secret>" } },
      schemas: {
        Error: { type: "object", properties: { error: { type: "string" }, requestId: { type: "string" }, issues: { type: "object" }, fields: { type: "object" } }, required: ["error"] },
      },
    },
    paths,
    "x-webhooks": {
      signature: "X-DeskForge-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>",
      events: ["ticket.created", "ticket.updated", "ticket.status_changed", "ticket.assigned", "ticket.commented", "ticket.merged", "ticket.deleted", "sla.warning", "sla.breached", "webhook.test"],
    },
  };
}
