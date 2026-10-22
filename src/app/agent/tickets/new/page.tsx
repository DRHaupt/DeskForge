import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { can } from "@/core/rbac/actor";
import { PageHeader } from "@/components/console/console-shell";
import { buildTicketMeta } from "@/lib/ticket-meta";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/session";
import { agentUserWhere } from "@/server/services/tickets";
import { NewTicketForm } from "./new-ticket-form";

export const metadata: Metadata = { title: "New ticket" };

export default async function NewTicketPage({ searchParams }: { searchParams: Promise<{ type?: string; parent?: string }> }) {
  const actor = await requirePagePermission("ticket.create", "/agent/tickets/new");
  const sp = await searchParams;
  const cfg = getConfig();
  const [teams, agents, categories, assets] = await Promise.all([
    db.team.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: agentUserWhere(), select: { id: true, name: true, teamMemberships: { select: { teamId: true } } }, orderBy: { name: "asc" } }),
    db.category.findMany({ where: { isActive: true }, select: { id: true, name: true, depth: true }, orderBy: { path: "asc" } }),
    cfg.features.assets ? db.asset.findMany({ where: { deletedAt: null }, select: { id: true, tag: true, name: true }, orderBy: { tag: "asc" }, take: 500 }) : Promise.resolve([]),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="New ticket" description="Log a ticket for yourself or on behalf of someone else." />
      <NewTicketForm
        meta={buildTicketMeta(cfg)}
        initialType={sp.type}
        parent={sp.parent}
        canOnBehalf={can(actor, "ticket.create_on_behalf")}
        me={{ id: actor.id, name: actor.name, email: actor.email }}
        teams={teams}
        agents={agents.map((a) => ({ id: a.id, name: a.name, teamIds: a.teamMemberships.map((m) => m.teamId) }))}
        categories={categories.map((c) => ({ id: c.id, label: `${"— ".repeat(c.depth)}${c.name}` }))}
        assets={assets.map((a) => ({ id: a.id, label: `${a.tag} · ${a.name}` }))}
      />
    </div>
  );
}
