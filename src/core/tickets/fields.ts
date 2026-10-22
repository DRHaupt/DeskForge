/**
 * Custom fields: build validators from config and map values to storage columns.
 */
import { z } from "zod";
import type { FieldConfig } from "../config/schema";

export type Audience = "agent" | "portal";

export type FieldStorage = { valueText: string | null; valueNumber: number | null; valueDate: Date | null; valueJson: unknown };

const id = z.string().min(1).max(64);

function valueSchema(f: FieldConfig): z.ZodType {
  switch (f.type) {
    case "text":
      return z.string().trim().max(500);
    case "textarea":
      return z.string().trim().max(10_000);
    case "number": {
      let s = z.number();
      if (f.min !== undefined) s = s.min(f.min);
      if (f.max !== undefined) s = s.max(f.max);
      return s;
    }
    case "dropdown": {
      const values = (f.options ?? []).map((o) => o.value);
      return z.string().refine((v) => values.includes(v), { message: `must be one of: ${values.join(", ")}` });
    }
    case "multiselect": {
      const values = (f.options ?? []).map((o) => o.value);
      return z
        .array(z.string())
        .max(values.length)
        .refine((arr) => arr.every((v) => values.includes(v)), { message: `values must be from: ${values.join(", ")}` })
        .transform((arr) => [...new Set(arr)]);
    }
    case "date":
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date (YYYY-MM-DD)");
    case "user":
    case "asset":
      return id;
    case "checkbox":
      return z.boolean();
  }
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

export function visibleFields(fields: FieldConfig[], audience: Audience): FieldConfig[] {
  return audience === "portal" ? fields.filter((f) => f.portal) : fields;
}

/**
 * Validates a `{ fieldKey: value }` object.
 * - mode "create": required fields must be present (for the audience).
 * - mode "update": only provided keys are validated; required fields can't be cleared.
 * Unknown keys are rejected. `null`/"" clears an optional field.
 */
export function buildFieldValuesSchema(fields: FieldConfig[], opts: { mode: "create" | "update"; audience: Audience }) {
  const allowed = visibleFields(fields, opts.audience);
  const shape: Record<string, z.ZodType> = {};
  for (const f of allowed) {
    const base = valueSchema(f);
    const nullable = z.union([base, z.null(), z.literal("")]).transform((v) => (v === "" ? null : v));
    shape[f.key] = opts.mode === "create" && f.required ? base : nullable.optional();
  }
  return z
    .object(shape)
    .strict()
    .superRefine((obj, ctx) => {
      for (const f of allowed) {
        const v = (obj as Record<string, unknown>)[f.key];
        if (f.required && opts.mode === "update" && f.key in obj && isEmpty(v)) {
          ctx.addIssue({ code: "custom", path: [f.key], message: `${f.label} is required` });
        }
        if (f.required && opts.mode === "create" && isEmpty(v)) {
          ctx.addIssue({ code: "custom", path: [f.key], message: `${f.label} is required` });
        }
      }
    });
}

export function toStorage(f: FieldConfig, value: unknown): FieldStorage {
  const empty: FieldStorage = { valueText: null, valueNumber: null, valueDate: null, valueJson: null };
  if (value === null || value === undefined) return empty;
  switch (f.type) {
    case "number":
      return { ...empty, valueNumber: value as number };
    case "date":
      return { ...empty, valueDate: new Date(`${value as string}T00:00:00Z`), valueText: value as string };
    case "multiselect":
      return { ...empty, valueJson: value, valueText: (value as string[]).join(", ") };
    case "checkbox":
      return { ...empty, valueJson: value, valueText: value ? "yes" : "no" };
    default:
      return { ...empty, valueText: String(value) };
  }
}

export function fromStorage(f: Pick<FieldConfig, "type">, row: FieldStorage): unknown {
  switch (f.type) {
    case "number":
      return row.valueNumber;
    case "date":
      return row.valueText ?? (row.valueDate ? row.valueDate.toISOString().slice(0, 10) : null);
    case "multiselect":
    case "checkbox":
      return row.valueJson;
    default:
      return row.valueText;
  }
}

/** Human-readable value for display, emails and CSV. */
export function displayValue(f: FieldConfig, value: unknown, lookup?: (id: string) => string | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (f.type === "dropdown") return f.options?.find((o) => o.value === value)?.label ?? String(value);
  if (f.type === "multiselect") return (value as string[]).map((v) => f.options?.find((o) => o.value === v)?.label ?? v).join(", ");
  if (f.type === "checkbox") return value ? "Yes" : "No";
  if ((f.type === "user" || f.type === "asset") && lookup) return lookup(String(value)) ?? String(value);
  return String(value);
}

/**
 * Tickets created indirectly (email, catalog request) can't ask the requester
 * for the ticket type's own required fields. Fill those with values from
 * `source` when keys match, otherwise with a neutral placeholder.
 */
export function fillRequiredFields(fields: FieldConfig[], source: Record<string, unknown> = {}, today = new Date()): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = source[f.key];
    if (v !== undefined && v !== null && v !== "") {
      out[f.key] = v;
      continue;
    }
    if (!f.required) continue;
    switch (f.type) {
      case "number":
        out[f.key] = f.min ?? 0;
        break;
      case "dropdown":
        out[f.key] = f.options![0]!.value;
        break;
      case "multiselect":
        out[f.key] = [f.options![0]!.value];
        break;
      case "date":
        out[f.key] = today.toISOString().slice(0, 10);
        break;
      case "checkbox":
        out[f.key] = false;
        break;
      case "user":
      case "asset":
        break;
      default:
        out[f.key] = "(see description)";
    }
  }
  // Only keep keys the type actually has.
  return Object.fromEntries(Object.entries(out).filter(([k]) => fields.some((f) => f.key === k)));
}
