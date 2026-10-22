import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { assetStatusLabel } from "@/core/assets/csv";
import { NotFoundError } from "@/core/errors";
import { can } from "@/core/rbac/actor";
import { PageHeader } from "@/components/console/console-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/format";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/session";
import { assetTypes, getAsset } from "@/server/services/assets";
import { AssetDialog } from "../asset-dialogs";
import { DeleteAssetButton, UnlinkButton } from "./asset-actions";

export async function generateMetadata({ params }: { params: Promise<{ tag: string }> }): Promise<Metadata> {
  return { title: decodeURIComponent((await params).tag) };
}

export default async function AssetPage({ params }: { params: Promise<{ tag: string }> }) {
  if (!getConfig().features.assets) notFound();
  const { tag } = await params;
  const actor = await requirePagePermission("asset.view", `/agent/assets/${tag}`);
  let asset;
  try {
    asset = await getAsset(actor, decodeURIComponent(tag));
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const manage = can(actor, "asset.manage");
  const tz = getConfig().locale.timezone;
  const [users, orgs, types] = manage
    ? await Promise.all([
        db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" }, take: 1000 }),
        db.organization.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        assetTypes(),
      ])
    : [[], [], []];
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const attributes = Object.entries((asset.attributes as Record<string, unknown> | null) ?? {});
  const facts: [string, React.ReactNode][] = [
    ["Type", asset.assetType],
    ["Status", <Badge key="s" variant="secondary">{assetStatusLabel(asset.status)}</Badge>],
    ["Owner", asset.owner ? `${asset.owner.name} (${asset.owner.email})` : "—"],
    ["Organization", asset.organization?.name ?? "—"],
    ["Serial number", asset.serialNumber ?? "—"],
    ["Manufacturer", asset.manufacturer ?? "—"],
    ["Model", asset.model ?? "—"],
    ["Location", asset.location ?? "—"],
    ["Purchased", asset.purchaseDate ? formatDate(asset.purchaseDate, tz) : "—"],
    ["Warranty ends", asset.warrantyExpiresAt ? formatDate(asset.warrantyExpiresAt, tz) : "—"],
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <p className="mb-2 text-sm">
        <Link href="/agent/assets" className="text-muted-foreground hover:underline">
          ← Assets
        </Link>
      </p>
      <PageHeader
        title={`${asset.tag} · ${asset.name}`}
        description={`Added ${formatDateTime(asset.createdAt, tz)} · updated ${formatDateTime(asset.updatedAt, tz)}`}
        actions={
          manage && (
            <div className="flex gap-2">
              <AssetDialog
                users={users}
                orgs={orgs}
                types={types}
                trigger={<Button variant="outline">Edit</Button>}
                asset={{ ...asset, purchaseDate: day(asset.purchaseDate), warrantyExpiresAt: day(asset.warrantyExpiresAt) }}
              />
              <DeleteAssetButton id={asset.id} tag={asset.tag} />
            </div>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
              {attributes.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="break-words">{String(v)}</dd>
                </div>
              ))}
            </dl>
            {asset.notes && <p className="mt-4 whitespace-pre-wrap border-t pt-3 text-sm">{asset.notes}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tickets ({asset.relationships.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {asset.relationships.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tickets have been linked to this asset.</p>
            ) : (
              <ul className="divide-y text-sm">
                {asset.relationships.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <Link href={`/agent/tickets/${r.sourceTicket.number}`} className="font-medium hover:underline">
                        {r.sourceTicket.number}
                      </Link>{" "}
                      <span className="text-muted-foreground">{r.sourceTicket.type.name}</span>
                      <div className="truncate">{r.sourceTicket.title}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={r.sourceTicket.statusCategory === "RESOLVED" || r.sourceTicket.statusCategory === "CLOSED" ? "outline" : "secondary"}>{r.sourceTicket.status.replace(/_/g, " ")}</Badge>
                      {manage && <UnlinkButton assetId={asset.id} relId={r.id} label={r.sourceTicket.number} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
