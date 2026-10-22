/**
 * CSV parsing/formatting (RFC 4180: quoted fields, escaped quotes, CRLF or LF,
 * newlines inside quotes) and the asset import row mapping.
 */
import { z } from "zod";

export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Quote a cell when needed. Cells starting with = + - @ are prefixed with ' to stop spreadsheet formula injection. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join("; ") : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ─── Assets ────────────────────────────────────────────────────────────────

export const ASSET_STATUSES = ["in_stock", "in_use", "in_repair", "retired", "disposed"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export function assetStatusLabel(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

/** Accepted header spellings → field. Matching ignores case, spaces, dashes and underscores. */
const HEADER_ALIASES: Record<string, string> = {
  tag: "tag", assettag: "tag", asset: "tag", id: "tag",
  name: "name", assetname: "name", hostname: "name", description: "name",
  type: "assetType", assettype: "assetType", category: "assetType", class: "assetType",
  status: "status", state: "status",
  serial: "serialNumber", serialnumber: "serialNumber", sn: "serialNumber",
  manufacturer: "manufacturer", make: "manufacturer", vendor: "manufacturer",
  model: "model",
  location: "location", site: "location",
  owner: "owner", owneremail: "owner", assignedto: "owner", user: "owner", email: "owner",
  organization: "organization", organisation: "organization", org: "organization", client: "organization", company: "organization",
  purchasedate: "purchaseDate", purchased: "purchaseDate",
  warranty: "warrantyExpiresAt", warrantyexpires: "warrantyExpiresAt", warrantyexpiry: "warrantyExpiresAt", warrantyend: "warrantyExpiresAt",
  notes: "notes", comments: "notes",
};

export function mapHeader(h: string): string | null {
  const k = h.toLowerCase().replace(/[\s_\-.]/g, "");
  return HEADER_ALIASES[k] ?? null;
}

const dateish = z
  .string()
  .trim()
  .transform((s, ctx) => {
    if (!s) return null;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: `"${s}" isn't a date (use YYYY-MM-DD)` });
      return z.NEVER;
    }
    return d;
  });

export const assetRowSchema = z.object({
  tag: z.string().trim().min(1, "tag is required").max(60),
  name: z.string().trim().min(1, "name is required").max(200),
  assetType: z.string().trim().min(1, "type is required").max(60),
  status: z
    .string()
    .trim()
    .transform((s) => s.toLowerCase().replace(/[\s-]+/g, "_") || "in_use")
    .pipe(z.enum(ASSET_STATUSES, { message: `status must be one of ${ASSET_STATUSES.join(", ")}` })),
  serialNumber: z.string().trim().max(120).optional(),
  manufacturer: z.string().trim().max(120).optional(),
  model: z.string().trim().max(120).optional(),
  location: z.string().trim().max(200).optional(),
  owner: z.string().trim().max(320).optional(),
  organization: z.string().trim().max(120).optional(),
  purchaseDate: dateish.optional(),
  warrantyExpiresAt: dateish.optional(),
  notes: z.string().max(5000).optional(),
});
export type AssetRow = z.infer<typeof assetRowSchema>;

export type MappedRows = { headers: (string | null)[]; extras: string[]; rows: { line: number; data: Record<string, string> }[] };

/** Map raw CSV into objects keyed by asset field. Unrecognised columns become `attr:<header>` attributes. */
export function mapAssetCsv(text: string): MappedRows {
  const [head, ...body] = parseCsv(text);
  if (!head) return { headers: [], rows: [], extras: [] };
  const headers = head.map(mapHeader);
  const extras = head.filter((_, i) => !headers[i]).map((h) => h.trim()).filter(Boolean);
  return {
    headers,
    extras,
    rows: body.map((cells, i) => {
      const data: Record<string, string> = {};
      cells.forEach((c, j) => {
        const key = headers[j] ?? (head[j]?.trim() ? `attr:${head[j]!.trim()}` : null);
        if (key) data[key] = c;
      });
      return { line: i + 2, data };
    }),
  };
}
