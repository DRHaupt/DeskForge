import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { can } from "@/core/rbac/actor";
import { PageHeader } from "@/components/console/console-shell";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/session";
import { listCanned } from "@/server/services/canned";
import { CannedAdmin } from "./canned-admin";

export const metadata: Metadata = { title: "Canned responses" };

export default async function CannedPage() {
  const actor = await requirePagePermission("ticket.reply", "/agent/canned");
  const cfg = getConfig();
  const [items, teams] = await Promise.all([listCanned(actor), db.team.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  return (
    <>
      <PageHeader title="Canned responses & macros" description="Reusable replies. Add actions to make a macro that also changes status, priority, tags or team when you send it." />
      <CannedAdmin
        items={JSON.parse(JSON.stringify(items))}
        me={actor.id}
        canShare={can(actor, "canned.manage")}
        teams={teams}
        statuses={[...new Map(cfg.ticketTypes.flatMap((t) => t.workflow.states).map((s) => [s.key, s.name])).entries()].map(([key, name]) => ({ key, name }))}
        priorities={cfg.priorities.levels.map((p) => ({ key: p.key, name: p.name }))}
      />
    </>
  );
}
