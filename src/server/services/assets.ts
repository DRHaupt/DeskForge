/**
 * Assets / CMDB: CRUD, CSV import and export, ticket links.
 * Staff need asset.view / asset.manage. Requesters only ever see assets
 * assigned to them (for the portal's "affected device" picker).
 */
import { z } from "zod";
import { ASSET_STATUSES, assetRowSchema, mapAssetCsv, toCsv } from "@/core/assets/csv";
import { ConflictError, NotFoundError, ValidationError } from "@/core/errors";
import { actorUserId, assertCan, type Actor } from "@/core/rbac/actor";
import type { Prisma } from "@/generated/prisma/client";
import { RelationshipType } from "@/generated/prisma/enums";
import { audit, diff, type AuditContext } from "../audit";
import { db } from "../db";
import { ticketVisibilityWhere } from "./ticket-access";

const isoDate = z.union([z.iso.date(), z.iso.datetime()]).nullable().optional();

export const assetInputSchema = z.object({
  tag: z.string().trim().min(1).max(60).regex(/^[\w.\-/#]+$/, "letters, numbers and . - _ / # only"),
  name: z.string().trim().min(1).max(200),
  assetType: z.string().trim().min(1).max(60),
  status: z.enum(ASSET_STATUSES).default("in_use"),
  serialNumber: z.string().trim().max(120).nullable().optional(),
  manufacturer: z.string().trim().max(120).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  ownerId: z.string().max(64).nullable().optional(),
  organizationId: z.string().max(64).nullable().optional(),
  purchaseDate: isoDate,
  warrantyExpiresAt: isoDate,
  attributes: z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean()])).refine((o) => Object.keys(o).length <= 50, "too many attributes").nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
});
export type AssetInput = z.input<typeof assetInputSchema>;

export const assetFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  type: z.string().max(60).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  ownerId: z.string().max(64).optional(),
  organizationId: z.string().max(64).optional(),
  warranty: z.enum(["expired", "expiring"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type AssetFilter = z.infer<typeof assetFilterSchema>;

const listInclude = { owner: { select: { id: true, name: true, email: true } }, organization: { select: { id: true, name: true } } } as const;

function whereFor(f: Partial<AssetFilter>): Prisma.AssetWhereInput {
  const now = new Date();
  const and: Prisma.AssetWhereInput[] = [{ deletedAt: null }];
  if (f.q) {
    const q = f.q;
    and.push({
      OR: [
        { tag: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { serialNumber: { contains: q, mode: "insensitive" } },
        { model: { contains: q, mode: "insensitive" } },
        { location: { contains: q, mode: "insensitive" } },
        { owner: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } },
      ],
    });
  }
  if (f.type) and.push({ assetType: f.type });
  if (f.status) and.push({ status: f.status });
  if (f.ownerId) and.push({ ownerId: f.ownerId });
  if (f.organizationId) and.push({ organizationId: f.organizationId });
  if (f.warranty === "expired") and.push({ warrantyExpiresAt: { lt: now } });
  if (f.warranty === "expiring") and.push({ warrantyExpiresAt: { gte: now, lt: new Date(now.getTime() + 90 * 86_400_000) } });
  return { AND: and };
}

export async function listAssets(actor: Actor, f: AssetFilter) {
  assertCan(actor, "asset.view");
  const where = whereFor(f);
  const [items, total, types] = await Promise.all([
    db.asset.findMany({ where, include: listInclude, orderBy: [{ tag: "asc" }], skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    db.asset.count({ where }),
    assetTypes(),
  ]);
  return { items, total, page: f.page, pageSize: f.pageSize, types };
}

export async function assetTypes(): Promise<string[]> {
  const rows = await db.asset.findMany({ where: { deletedAt: null }, distinct: ["assetType"], select: { assetType: true }, orderBy: { assetType: "asc" } });
  return rows.map((r) => r.assetType);
}

export async function getAsset(actor: Actor, idOrTag: string) {
  assertCan(actor, "asset.view");
  const asset = await db.asset.findFirst({
    where: { OR: [{ id: idOrTag }, { tag: idOrTag }], deletedAt: null },
    include: {
      ...listInclude,
      relationships: {
        where: { sourceTicket: { AND: [{ deletedAt: null }, ticketVisibilityWhere(actor)] } },
        include: { sourceTicket: { select: { id: true, number: true, title: true, status: true, statusCategory: true, priority: true, createdAt: true, type: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      },
    },
  });
  if (!asset) throw new NotFoundError("Asset");
  return asset;
}

/** Assets assigned to the signed-in user (portal picker). */
export async function listMyAssets(actor: Actor) {
  const uid = actorUserId(actor);
  if (!uid) return [];
  return db.asset.findMany({ where: { ownerId: uid, deletedAt: null, status: { notIn: ["retired", "disposed"] } }, select: { id: true, tag: true, name: true, assetType: true, model: true }, orderBy: { tag: "asc" } });
}

async function checkRefs(input: { ownerId?: string | null; organizationId?: string | null }) {
  if (input.ownerId && !(await db.user.findUnique({ where: { id: input.ownerId } }))) throw new ValidationError("Unknown owner", { ownerId: "unknown" });
  if (input.organizationId && !(await db.organization.findUnique({ where: { id: input.organizationId } }))) throw new ValidationError("Unknown organization", { organizationId: "unknown" });
}

function toData(input: Partial<z.infer<typeof assetInputSchema>>) {
  const { purchaseDate, warrantyExpiresAt, attributes, ...rest } = input;
  return {
    ...rest,
    ...(purchaseDate !== undefined ? { purchaseDate: purchaseDate ? new Date(purchaseDate) : null } : {}),
    ...(warrantyExpiresAt !== undefined ? { warrantyExpiresAt: warrantyExpiresAt ? new Date(warrantyExpiresAt) : null } : {}),
    ...(attributes !== undefined ? { attributes: attributes ?? undefined } : {}),
  };
}

export async function createAsset(actor: Actor, raw: AssetInput, ctx?: AuditContext) {
  assertCan(actor, "asset.manage");
  const input = assetInputSchema.parse(raw);
  await checkRefs(input);
  if (await db.asset.findUnique({ where: { tag: input.tag } })) throw new ConflictError(`Asset tag ${input.tag} is already in use`);
  const a = await db.asset.create({ data: toData(input) as Prisma.AssetUncheckedCreateInput });
  await audit(actor, { action: "asset.create", entityType: "asset", entityId: a.id, changes: { tag: a.tag, name: a.name } }, ctx);
  return { id: a.id, tag: a.tag };
}

export async function updateAsset(actor: Actor, id: string, raw: Partial<AssetInput>, ctx?: AuditContext) {
  assertCan(actor, "asset.manage");
  const before = await db.asset.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw new NotFoundError("Asset");
  const input = assetInputSchema.partial().parse(raw);
  await checkRefs(input);
  if (input.tag && input.tag !== before.tag && (await db.asset.findUnique({ where: { tag: input.tag } }))) throw new ConflictError(`Asset tag ${input.tag} is already in use`);
  const after = await db.asset.update({ where: { id }, data: toData(input) as Prisma.AssetUncheckedUpdateInput });
  const changes = diff(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
  delete changes.updatedAt;
  await audit(actor, { action: "asset.update", entityType: "asset", entityId: id, changes }, ctx);
  return { id };
}

/** Soft delete. The tag is freed (suffixed) so it can be reused. */
export async function deleteAsset(actor: Actor, id: string, ctx?: AuditContext) {
  assertCan(actor, "asset.manage");
  const a = await db.asset.findFirst({ where: { id, deletedAt: null } });
  if (!a) throw new NotFoundError("Asset");
  await db.asset.update({ where: { id }, data: { deletedAt: new Date(), tag: `${a.tag}~deleted~${id.slice(-6)}` } });
  await audit(actor, { action: "asset.delete", entityType: "asset", entityId: id, changes: { tag: a.tag } }, ctx);
  return { id };
}

// ─── CSV ───────────────────────────────────────────────────────────────────

export const MAX_IMPORT_ROWS = 5000;
export const importSchema = z.object({ csv: z.string().min(1).max(5_000_000), dryRun: z.boolean().default(false) });

export type ImportReport = { created: number; updated: number; unchanged: number; errors: { line: number; message: string }[]; extras: string[]; dryRun: boolean };

/**
 * Import or update assets from CSV, matched by tag. Owners are matched by
 * email, organizations by slug or name. Unknown columns are stored as
 * attributes. Rows with errors are skipped and reported; the rest are applied
 * (unless dryRun).
 */
export async function importAssets(actor: Actor, raw: z.input<typeof importSchema>, ctx?: AuditContext): Promise<ImportReport> {
  assertCan(actor, "asset.manage");
  const { csv, dryRun } = importSchema.parse(raw);
  const mapped = mapAssetCsv(csv);
  if (!mapped.headers.length) throw new ValidationError("The file is empty");
  for (const required of ["tag", "name", "assetType"]) {
    if (!mapped.headers.includes(required)) throw new ValidationError(`Missing a "${required === "assetType" ? "type" : required}" column`);
  }
  if (mapped.rows.length > MAX_IMPORT_ROWS) throw new ValidationError(`Import at most ${MAX_IMPORT_ROWS} rows at a time`);

  const [users, orgs, existing] = await Promise.all([
    db.user.findMany({ select: { id: true, email: true } }),
    db.organization.findMany({ select: { id: true, slug: true, name: true } }),
    db.asset.findMany({ where: { deletedAt: null }, select: { id: true, tag: true } }),
  ]);
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  const orgByKey = new Map<string, string>();
  for (const o of orgs) {
    orgByKey.set(o.slug.toLowerCase(), o.id);
    orgByKey.set(o.name.toLowerCase(), o.id);
  }
  const existingByTag = new Map(existing.map((a) => [a.tag.toLowerCase(), a.id]));

  const report: ImportReport = { created: 0, updated: 0, unchanged: 0, errors: [], extras: mapped.extras, dryRun };
  const seen = new Set<string>();
  for (const { line, data } of mapped.rows) {
    const parsed = assetRowSchema.safeParse(data);
    if (!parsed.success) {
      report.errors.push({ line, message: parsed.error.issues.map((i) => `${String(i.path[0] ?? "")}: ${i.message}`).join("; ") });
      continue;
    }
    const r = parsed.data;
    const tagKey = r.tag.toLowerCase();
    if (seen.has(tagKey)) {
      report.errors.push({ line, message: `tag ${r.tag} appears more than once in the file` });
      continue;
    }
    seen.add(tagKey);
    let ownerId: string | null | undefined;
    if (r.owner !== undefined) {
      ownerId = r.owner ? (userByEmail.get(r.owner.toLowerCase()) ?? undefined) : null;
      if (ownerId === undefined) {
        report.errors.push({ line, message: `owner: no user with email ${r.owner}` });
        continue;
      }
    }
    let organizationId: string | null | undefined;
    if (r.organization !== undefined) {
      organizationId = r.organization ? (orgByKey.get(r.organization.toLowerCase()) ?? undefined) : null;
      if (organizationId === undefined) {
        report.errors.push({ line, message: `organization: no organization called ${r.organization}` });
        continue;
      }
    }
    const attributes = Object.fromEntries(Object.entries(data).filter(([k, v]) => k.startsWith("attr:") && v.trim() !== "").map(([k, v]) => [k.slice(5), v.trim()]));
    const opt = (v: string | undefined) => (v === undefined ? undefined : v || null);
    const record = {
      tag: r.tag,
      name: r.name,
      assetType: r.assetType,
      status: r.status,
      serialNumber: opt(r.serialNumber),
      manufacturer: opt(r.manufacturer),
      model: opt(r.model),
      location: opt(r.location),
      notes: opt(r.notes),
      ownerId,
      organizationId,
      purchaseDate: r.purchaseDate,
      warrantyExpiresAt: r.warrantyExpiresAt,
      ...(Object.keys(attributes).length ? { attributes } : {}),
    };
    const id = existingByTag.get(tagKey);
    if (dryRun) {
      if (id) report.updated++;
      else report.created++;
      continue;
    }
    if (id) {
      await db.asset.update({ where: { id }, data: record });
      report.updated++;
    } else {
      await db.asset.create({ data: record });
      report.created++;
    }
  }
  if (!dryRun) await audit(actor, { action: "asset.import", entityType: "asset", entityId: null, changes: { created: report.created, updated: report.updated, errors: report.errors.length } }, ctx);
  return report;
}

export const EXPORT_COLUMNS = ["tag", "name", "type", "status", "serial", "manufacturer", "model", "location", "owner", "organization", "purchase_date", "warranty_expires", "notes"];

export async function exportAssetsCsv(actor: Actor, f: Partial<AssetFilter>): Promise<string> {
  assertCan(actor, "asset.view");
  const rows = await db.asset.findMany({ where: whereFor(f), include: listInclude, orderBy: { tag: "asc" }, take: 50_000 });
  const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : "");
  return toCsv(
    EXPORT_COLUMNS,
    rows.map((a) => [a.tag, a.name, a.assetType, a.status, a.serialNumber, a.manufacturer, a.model, a.location, a.owner?.email, a.organization?.name, d(a.purchaseDate), d(a.warrantyExpiresAt), a.notes]),
  );
}

/** Unlink helper for the asset page. */
export async function unlinkAssetTicket(actor: Actor, assetId: string, relationshipId: string, ctx?: AuditContext) {
  assertCan(actor, "asset.manage");
  const rel = await db.relationship.findFirst({ where: { id: relationshipId, targetAssetId: assetId, type: RelationshipType.AFFECTS_ASSET } });
  if (!rel) throw new NotFoundError("Link");
  await db.relationship.delete({ where: { id: rel.id } });
  await audit(actor, { action: "ticket.unlink", entityType: "ticket", entityId: rel.sourceTicketId, changes: { type: rel.type, asset: assetId } }, ctx);
  return { id: rel.id };
}
