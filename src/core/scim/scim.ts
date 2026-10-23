/**
 * SCIM 2.0 (RFC 7643/7644) helpers for user provisioning, pure and
 * framework-free. Written against what Microsoft Entra sends: filters like
 * `userName eq "x"`, PATCH operations with or without a path, booleans as the
 * strings "True"/"False", and `emails[type eq "work"].value` paths.
 */

export const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const ENTERPRISE_SCHEMA = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
export const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
export const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

/** Attributes DeskForge keeps from a SCIM user. `undefined` = not mentioned; `null` = cleared. */
export type UserChanges = {
  userName?: string;
  externalId?: string | null;
  active?: boolean;
  displayName?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  formatted?: string | null;
  email?: string | null;
  title?: string | null;
  phone?: string | null;
};

export class ScimError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly scimType?: string,
  ) {
    super(message);
  }
}

// ─── Filters ───────────────────────────────────────────────────────────────

export type Filter = { attr: "userName" | "externalId" | "id" | "email"; value: string };

/** Supports `<attr> eq "<value>"` for userName, externalId, id and emails. */
export function parseFilter(filter: string | null | undefined): Filter | null {
  if (!filter) return null;
  const m = filter.trim().match(/^([\w.:[\]" ]+?)\s+eq\s+"((?:[^"\\]|\\.)*)"$/i);
  if (!m) throw new ScimError(400, `Unsupported filter: ${filter}`, "invalidFilter");
  const raw = m[1]!.trim().toLowerCase().replace(/\s+/g, " ");
  const value = m[2]!.replace(/\\(.)/g, "$1");
  if (raw === "username") return { attr: "userName", value };
  if (raw === "externalid") return { attr: "externalId", value };
  if (raw === "id") return { attr: "id", value };
  if (raw === "emails.value" || raw === 'emails[type eq "work"].value' || raw === "emails") return { attr: "email", value };
  throw new ScimError(400, `Filtering on ${m[1]} isn't supported`, "invalidFilter");
}

// ─── Values ────────────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/** Entra sends booleans as "True"/"False" in PATCH. */
export function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  throw new ScimError(400, `Expected a boolean, got ${JSON.stringify(v)}`, "invalidValue");
}

type MultiValue = { value?: unknown; type?: unknown; primary?: unknown };

/** Pick the work (or primary, or first) value from a multi-valued attribute. */
function pick(list: unknown): string | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const items = list as MultiValue[];
  const chosen = items.find((i) => String(i.type ?? "").toLowerCase() === "work") ?? items.find((i) => i.primary === true || i.primary === "True") ?? items[0];
  return str(chosen?.value);
}

// ─── Full resources (POST / PUT) ───────────────────────────────────────────

export function changesFromResource(r: Record<string, unknown>): UserChanges {
  const name = (r.name ?? {}) as Record<string, unknown>;
  const userName = str(r.userName);
  if (!userName) throw new ScimError(400, "userName is required", "invalidValue");
  return {
    userName,
    externalId: str(r.externalId),
    active: r.active === undefined ? true : bool(r.active),
    displayName: str(r.displayName),
    givenName: str(name.givenName),
    familyName: str(name.familyName),
    formatted: str(name.formatted),
    email: pick(r.emails),
    title: str(r.title),
    phone: pick(r.phoneNumbers),
  };
}

// ─── PATCH ─────────────────────────────────────────────────────────────────

const PATH_MAP: Record<string, keyof UserChanges> = {
  username: "userName",
  externalid: "externalId",
  active: "active",
  displayname: "displayName",
  "name.givenname": "givenName",
  "name.familyname": "familyName",
  "name.formatted": "formatted",
  title: "title",
  'emails[type eq "work"].value': "email",
  "emails.value": "email",
  'phonenumbers[type eq "work"].value': "phone",
  'phonenumbers[type eq "mobile"].value': "phone",
};

function applyPath(out: UserChanges, path: string, value: unknown, remove: boolean) {
  const key = path.trim().toLowerCase().replace(/\s+/g, " ").replace(`${USER_SCHEMA.toLowerCase()}:`, "");
  if (key === "emails" || key === "phonenumbers") {
    (out as Record<string, unknown>)[key === "emails" ? "email" : "phone"] = remove ? null : pick(value);
    return;
  }
  if (key === "name" && value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) applyPath(out, `name.${k}`, v, remove);
    return;
  }
  const field = PATH_MAP[key];
  if (!field) return; // Unknown or unsupported attribute (enterprise extension, addresses…): ignore.
  if (field === "active") {
    if (!remove) out.active = bool(value);
    return;
  }
  if (field === "userName") {
    const v = str(value);
    if (!remove && v) out.userName = v;
    return;
  }
  (out as Record<string, unknown>)[field] = remove ? null : str(value);
}

export function changesFromPatch(body: Record<string, unknown>): UserChanges {
  const ops = body.Operations ?? body.operations;
  if (!Array.isArray(ops)) throw new ScimError(400, "Operations is required", "invalidSyntax");
  const out: UserChanges = {};
  for (const raw of ops as Record<string, unknown>[]) {
    const op = String(raw.op ?? "").toLowerCase();
    if (!["add", "replace", "remove"].includes(op)) throw new ScimError(400, `Unsupported op ${String(raw.op)}`, "invalidSyntax");
    const remove = op === "remove";
    const path = typeof raw.path === "string" ? raw.path : null;
    if (path) {
      applyPath(out, path, raw.value, remove);
    } else if (raw.value && typeof raw.value === "object" && !Array.isArray(raw.value)) {
      // No path: the value is an object of attributes, possibly with dotted keys.
      for (const [k, v] of Object.entries(raw.value as Record<string, unknown>)) applyPath(out, k, v, remove);
    }
  }
  return out;
}

/** The display name to store, from whatever the IdP provided. */
export function displayNameFrom(c: UserChanges, fallback: string): string {
  return c.displayName || c.formatted || [c.givenName, c.familyName].filter(Boolean).join(" ") || fallback;
}

export function scimError(status: number, detail: string, scimType?: string) {
  return { schemas: [ERROR_SCHEMA], status: String(status), detail, ...(scimType ? { scimType } : {}) };
}
