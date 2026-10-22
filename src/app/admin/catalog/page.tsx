import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getConfig } from "@/core/config/loader";
import { activeTicketTypes } from "@/core/config/helpers";
import { PageHeader } from "@/components/console/console-shell";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/session";
import { listCatalogItems } from "@/server/services/catalog";
import { agentUserWhere } from "@/server/services/tickets";
import { CatalogAdmin } from "./catalog-admin";

export const metadata: Metadata = { title: "Service catalog" };

export default async function CatalogAdminPage() {
  const cfg = getConfig();
  if (!cfg.features.serviceCatalog) notFound();
  const actor = await requirePagePermission("catalog.manage", "/admin/catalog");
  const [items, teams, users] = await Promise.all([
    listCatalogItems(actor, { includeInactive: true }),
    db.team.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: agentUserWhere(), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Service catalog" description="Items requesters can order from the portal. Each creates a ticket; approval is optional." />
      <CatalogAdmin
        items={JSON.parse(JSON.stringify(items))}
        teams={teams}
        users={users}
        types={activeTicketTypes(cfg).map((t) => ({ key: t.key, name: t.name }))}
        priorities={cfg.priorities.levels.map((p) => ({ key: p.key, name: p.name }))}
      />
    </>
  );
}
