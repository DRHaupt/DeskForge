import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { getConfig } from "@/core/config/loader";
import { can } from "@/core/rbac/actor";
import { PageHeader } from "@/components/console/console-shell";
import { Pagination } from "@/components/console/pagination";
import { Button } from "@/components/ui/button";
import { buildTicketMeta } from "@/lib/ticket-meta";
import { cn } from "@/lib/utils";
import { db } from "@/server/db";
import { requireAgent } from "@/server/session";
import { agentUserWhere, filterWhere, listTickets, ticketFilterSchema } from "@/server/services/tickets";
import { listViews } from "@/server/services/views";
import { queuePresets } from "./queues";
import { TicketTable } from "./ticket-table";
import { FilterBar } from "./filter-bar";

export const metadata: Metadata = { title: "Tickets" };

const FILTER_KEYS = ["q", "status", "statusCategory", "priority", "type", "teamId", "assignee", "requesterId", "organizationId", "categoryId", "tag", "open", "watching", "createdFrom", "createdTo", "sort", "dir"];

export default async function TicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireAgent("/agent/tickets");
  const sp = await searchParams;
  const cfg = getConfig();
  const teams = await db.team.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const presets = queuePresets(actor, teams);
  const views = await listViews(actor);

  // Active filters: explicit params win; otherwise a preset/view; default "mine".
  const explicit = Object.fromEntries(FILTER_KEYS.filter((k) => sp[k]).map((k) => [k, sp[k]!]));
  const viewId = sp.view ?? (Object.keys(explicit).length ? undefined : "mine");
  const preset = presets.find((p) => p.id === viewId);
  const saved = views.find((v) => v.id === viewId);
  const base = preset?.filters ?? (saved?.filters as Record<string, string> | undefined) ?? {};
  const active = { ...base, ...explicit };
  const filters = ticketFilterSchema.parse({ ...active, page: sp.page });

  const [result, counts, agents] = await Promise.all([
    listTickets(actor, filters),
    Promise.all(presets.map((p) => db.ticket.count({ where: filterWhere(actor, ticketFilterSchema.parse(p.filters)) }))),
    db.user.findMany({ where: agentUserWhere(), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const meta = buildTicketMeta(cfg);
  const title = preset?.label ?? saved?.name ?? "Tickets";

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <nav aria-label="Queues" className="shrink-0 xl:w-56">
        <ul className="flex gap-1 overflow-x-auto xl:flex-col">
          {presets.map((p, i) => (
            <li key={p.id}>
              <Link
                href={`/agent/tickets?view=${p.id}`}
                aria-current={viewId === p.id ? "page" : undefined}
                className={cn("flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap hover:bg-accent", viewId === p.id && "bg-primary/10 font-medium text-primary")}
              >
                {p.label}
                <span className="text-xs text-muted-foreground tabular-nums">{counts[i]}</span>
              </Link>
            </li>
          ))}
        </ul>
        {views.length > 0 && (
          <>
            <p className="mt-5 mb-1 hidden px-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase xl:block">Saved views</p>
            <ul className="flex gap-1 overflow-x-auto xl:flex-col">
              {views.map((v) => (
                <li key={v.id}>
                  <Link
                    href={`/agent/tickets?view=${v.id}`}
                    aria-current={viewId === v.id ? "page" : undefined}
                    className={cn("block rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap hover:bg-accent", viewId === v.id && "bg-primary/10 font-medium text-primary")}
                  >
                    {v.name} {v.isShared && <span className="text-xs text-muted-foreground">(shared)</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </nav>
      <div className="min-w-0 flex-1">
        <PageHeader
          title={title}
          actions={
            can(actor, "ticket.create") && (
              <Button asChild>
                <Link href="/agent/tickets/new" aria-keyshortcuts="c">
                  <Plus /> New ticket
                </Link>
              </Button>
            )
          }
        />
        <FilterBar
          active={active}
          meta={meta}
          teams={teams}
          agents={agents}
          canShare={can(actor, "view.share")}
          savedViewId={saved && saved.ownerId === actor.id ? saved.id : undefined}
        />
        <TicketTable
          items={result.items.map((t) => ({
            id: t.id,
            number: t.number,
            title: t.title,
            typeKey: t.type.key,
            status: t.status,
            statusCategory: t.statusCategory,
            priority: t.priority,
            requester: t.requester.name,
            organization: t.organization?.name ?? null,
            assignee: t.assignee?.name ?? null,
            team: t.team?.name ?? null,
            updatedAt: t.updatedAt.toISOString(),
            sla: t.slaInstances.map((s) => ({ metric: s.metric, status: s.status, dueAt: s.dueAt.toISOString() })),
          }))}
          meta={meta}
          canBulk={can(actor, "ticket.bulk")}
          teams={teams}
          agents={agents}
        />
        <Pagination page={result.page} pageSize={result.pageSize} total={result.total} baseHref="/agent/tickets" params={{ ...active, view: viewId }} />
      </div>
    </div>
  );
}
