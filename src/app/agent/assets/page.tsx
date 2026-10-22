import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { ASSET_STATUSES, assetStatusLabel as statusLabel } from "@/core/assets/csv";
import { can } from "@/core/rbac/actor";
import { PageHeader } from "@/components/console/console-shell";
import { Pagination } from "@/components/console/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/session";
import { assetFilterSchema, listAssets } from "@/server/services/assets";
import { AssetDialog, ImportDialog } from "./asset-dialogs";

export const metadata: Metadata = { title: "Assets" };
const sel = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

export default async function AssetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!getConfig().features.assets) notFound();
  const actor = await requirePagePermission("asset.view", "/agent/assets");
  const sp = await searchParams;
  const parsed = assetFilterSchema.safeParse({ ...sp, pageSize: 50 });
  const filter = parsed.success ? parsed.data : assetFilterSchema.parse({});
  const [result, users, orgs] = await Promise.all([
    listAssets(actor, filter),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" }, take: 1000 }),
    db.organization.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const manage = can(actor, "asset.manage");
  const tz = getConfig().locale.timezone;
  const now = Date.now();
  const exportQs = new URLSearchParams(Object.entries({ q: filter.q, type: filter.type, status: filter.status, warranty: filter.warranty }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title="Assets"
        description="Hardware, software and services you support, and the tickets that affected them."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href={`/api/v1/assets/export${exportQs ? `?${exportQs}` : ""}`} download>
                Export CSV
              </a>
            </Button>
            {manage && <ImportDialog />}
            {manage && <AssetDialog users={users} orgs={orgs} types={result.types} />}
          </div>
        }
      />
      <form className="mb-4 flex flex-wrap gap-2" role="search" aria-label="Filter assets">
        <Input name="q" defaultValue={filter.q} placeholder="Tag, name, serial, owner…" className="max-w-xs" aria-label="Search assets" />
        <select name="type" defaultValue={filter.type ?? ""} aria-label="Type" className={sel}>
          <option value="">All types</option>
          {result.types.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select name="status" defaultValue={filter.status ?? ""} aria-label="Status" className={sel}>
          <option value="">Any status</option>
          {ASSET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <select name="warranty" defaultValue={filter.warranty ?? ""} aria-label="Warranty" className={sel}>
          <option value="">Any warranty</option>
          <option value="expiring">Expiring within 90 days</option>
          <option value="expired">Expired</option>
        </select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Asset</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Owner</TableHead>
              <TableHead className="hidden lg:table-cell">Location</TableHead>
              <TableHead className="hidden lg:table-cell">Warranty</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.items.map((a) => {
              const expired = a.warrantyExpiresAt && a.warrantyExpiresAt.getTime() < now;
              return (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link href={`/agent/assets/${encodeURIComponent(a.tag)}`} className="font-medium hover:underline">
                      {a.tag}
                    </Link>
                    <div className="text-xs text-muted-foreground">{a.name}</div>
                  </TableCell>
                  <TableCell>{a.assetType}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === "in_use" ? "secondary" : "outline"}>{statusLabel(a.status)}</Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {a.owner?.name ?? <span className="text-muted-foreground">—</span>}
                    {a.organization && <div className="text-xs text-muted-foreground">{a.organization.name}</div>}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{a.location ?? "—"}</TableCell>
                  <TableCell className={`hidden lg:table-cell ${expired ? "text-destructive" : ""}`}>{a.warrantyExpiresAt ? `${expired ? "Expired " : ""}${formatDate(a.warrantyExpiresAt, tz)}` : "—"}</TableCell>
                </TableRow>
              );
            })}
            {result.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No assets match. {manage && "Add one, or import a CSV."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      <Pagination page={result.page} pageSize={result.pageSize} total={result.total} baseHref="/agent/assets" params={{ q: filter.q, type: filter.type, status: filter.status, warranty: filter.warranty }} />
    </>
  );
}
