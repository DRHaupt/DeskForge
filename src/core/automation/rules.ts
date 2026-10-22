/**
 * Automation rules: trigger → conditions → actions.
 *
 * Pure module: schemas, condition evaluation over a flat "facts" object, and
 * message templating. The server builds facts from a ticket + event and
 * executes the actions through the normal services (so permissions, workflow
 * and audit apply), see src/server/automation.ts.
 */
import { z } from "zod";

export const AUTOMATION_TRIGGERS = [
  "ticket.created",
  "ticket.updated",
  "ticket.status_changed",
  "ticket.assigned",
  "ticket.commented",
  "sla.warning",
  "sla.breached",
  "schedule",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const OPERATORS = ["eq", "neq", "in", "not_in", "contains", "not_contains", "starts_with", "gt", "gte", "lt", "lte", "is_set", "is_not_set", "changed", "changed_to", "changed_from"] as const;
export type Operator = (typeof OPERATORS)[number];

/** Fields usable in conditions. `field.<key>` addresses custom fields. */
export const CONDITION_FIELDS = [
  "type",
  "status",
  "statusCategory",
  "priority",
  "impact",
  "urgency",
  "team",
  "assignee",
  "requester.email",
  "requester.domain",
  "organization",
  "category",
  "tags",
  "title",
  "description",
  "source",
  "hoursSinceCreated",
  "hoursSinceUpdated",
  "hoursInStatus",
  "comment.visibility",
  "comment.byRequester",
  "comment.text",
  "sla.metric",
] as const;

export const conditionSchema = z.object({
  field: z.string().regex(/^(field\.[a-z][a-z0-9_-]*|[a-zA-Z.]+)$/).refine((f) => f.startsWith("field.") || (CONDITION_FIELDS as readonly string[]).includes(f), { message: "unknown condition field" }),
  op: z.enum(OPERATORS),
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(200)).max(50), z.null()]).optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export const conditionsSchema = z.object({
  all: z.array(conditionSchema).max(30).default([]),
  any: z.array(conditionSchema).max(30).default([]),
});
export type Conditions = z.infer<typeof conditionsSchema>;

const str = z.string().trim().min(1).max(200);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_priority"), value: str }),
  z.object({ type: z.literal("set_status"), value: str, comment: z.string().max(5000).optional() }),
  z.object({ type: z.literal("assign_team"), team: str, keepAssignee: z.boolean().optional() }),
  /** user: email, user id, or "unassigned" */
  z.object({ type: z.literal("assign_user"), user: str }),
  z.object({ type: z.literal("add_tag"), value: str }),
  z.object({ type: z.literal("remove_tag"), value: str }),
  z.object({ type: z.literal("set_field"), key: z.string().regex(/^[a-z][a-z0-9_-]*$/), value: z.union([z.string().max(1000), z.number(), z.boolean(), z.array(z.string()).max(20), z.null()]) }),
  z.object({ type: z.literal("add_comment"), body: z.string().min(1).max(20_000), visibility: z.enum(["PUBLIC", "INTERNAL"]).default("INTERNAL") }),
  /** to: "assignee" | "requester" | "team" | "team_leads" | an email address */
  z.object({ type: z.literal("notify"), to: z.array(str).min(1).max(10), subject: z.string().max(200).optional(), message: z.string().min(1).max(5000) }),
  z.object({ type: z.literal("add_watcher"), email: z.email() }),
  /** Deliver the event to a configured webhook (signed, retried). */
  z.object({ type: z.literal("webhook"), webhookId: str }),
]);
export type AutomationAction = z.infer<typeof actionSchema>;

export const automationInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(1000).nullable().optional(),
  isActive: z.boolean().default(true),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  /** For "schedule": run every N minutes (5–1440). */
  schedule: z.string().regex(/^every \d{1,4}m$/, 'use "every 15m" style').nullable().optional(),
  conditions: conditionsSchema,
  actions: z.array(actionSchema).min(1).max(20),
  order: z.number().int().min(0).max(10_000).default(0),
  stopProcessing: z.boolean().default(false),
});
export type AutomationInput = z.infer<typeof automationInputSchema>;

export function scheduleMinutes(schedule: string | null | undefined): number {
  const m = schedule?.match(/^every (\d+)m$/);
  return Math.min(1440, Math.max(5, m ? Number(m[1]) : 60));
}

// ─── Evaluation ────────────────────────────────────────────────────────────

/** Flat facts: plain values, plus `changed` map {field: {from,to}} for update events. */
export type Facts = Record<string, unknown> & { changed?: Record<string, { from: unknown; to: unknown }> };

function norm(v: unknown): unknown {
  return typeof v === "string" ? v.toLowerCase() : v;
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null) return [];
  return [v];
}

export function evaluateCondition(c: Condition, facts: Facts): boolean {
  const actual = facts[c.field];
  const expected = c.value;
  const changeKey = c.field.replace(/^field\./, "field.");
  switch (c.op) {
    case "is_set":
      return !(actual === undefined || actual === null || actual === "" || (Array.isArray(actual) && actual.length === 0));
    case "is_not_set":
      return actual === undefined || actual === null || actual === "" || (Array.isArray(actual) && actual.length === 0);
    case "changed":
      return Boolean(facts.changed && changeKey in facts.changed);
    case "changed_to":
      return Boolean(facts.changed?.[changeKey] && norm(facts.changed[changeKey]!.to) === norm(expected));
    case "changed_from":
      return Boolean(facts.changed?.[changeKey] && norm(facts.changed[changeKey]!.from) === norm(expected));
    case "eq":
      return Array.isArray(actual) ? actual.map(norm).includes(norm(expected)) : norm(actual) === norm(expected);
    case "neq":
      return Array.isArray(actual) ? !actual.map(norm).includes(norm(expected)) : norm(actual) !== norm(expected);
    case "in": {
      const set = asArray(expected).map(norm);
      return Array.isArray(actual) ? actual.some((a) => set.includes(norm(a))) : set.includes(norm(actual));
    }
    case "not_in": {
      const set = asArray(expected).map(norm);
      return Array.isArray(actual) ? !actual.some((a) => set.includes(norm(a))) : !set.includes(norm(actual));
    }
    case "contains":
      return Array.isArray(actual) ? actual.map(norm).includes(norm(expected)) : String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "not_contains":
      return Array.isArray(actual) ? !actual.map(norm).includes(norm(expected)) : !String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
    case "starts_with":
      return String(actual ?? "").toLowerCase().startsWith(String(expected ?? "").toLowerCase());
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
  }
}

/** All `all` conditions must hold, and at least one `any` condition (if there are any). */
export function evaluateConditions(conditions: Conditions, facts: Facts): boolean {
  if (!conditions.all.every((c) => evaluateCondition(c, facts))) return false;
  if (conditions.any.length && !conditions.any.some((c) => evaluateCondition(c, facts))) return false;
  return true;
}

// ─── Templates ─────────────────────────────────────────────────────────────

/**
 * Replace {{path}} placeholders from a flat map. Unknown placeholders become
 * empty. Values are HTML-escaped when `html` is true (comment bodies, emails).
 */
export function renderTemplate(template: string, vars: Record<string, unknown>, opts: { html?: boolean } = {}): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    const s = v === undefined || v === null ? "" : Array.isArray(v) ? v.join(", ") : String(v);
    return opts.html ? s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") : s;
  });
}

/** Maximum chain length of automation → change → automation. */
export const MAX_AUTOMATION_DEPTH = 3;
