import Link from "next/link";
import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { StatusBadge } from "@/components/tickets/badges";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { buildTicketMeta, stateColor, stateLabel } from "@/lib/ticket-meta";
import { cn } from "@/lib/utils";
import { db } from "@/server/db";
import { requireActor } from "@/server/session";
import { ticketVisibilityWhere } from "@/server/services/ticket-access";

export const metadata: Metadata = { title: "My requests" };

export default async function PortalTickets({ searchParams }: { searchParams: Promise<{ show?: string; scope?: string }> }) {
  const actor = await requireActor("/portal/tickets");
  const { show = "open", scope = "mine" } = await searchParams;
  const meta = buildTicketMeta(getConfig());
  const orgAccess = Boolean(actor.organizationId && (actor.orgTicketAccess || actor.permissions.has("ticket.view_org")));
  const where = {
    AND: [
      { deletedAt: null },
      ticketVisibilityWhere(actor),
      scope === "org" && orgAccess ? { organizationId: actor.organizationId } : { OR: [{ requesterId: actor.id }, { watchers: { some: { userId: actor.id } } }] },
      show === "closed" ? { statusCategory: { in: ["RESOLVED" as const, "CLOSED" as const] } } : { statusCategory: { in: ["NEW" as const, "OPEN" as const, "PENDING" as const] } },
    ],
  };
  const tickets = await db.ticket.findMany({ where, orderBy: { updatedAt: "desc" }, take: 100, include: { type: { select: { key: true, name: true } }, requester: { select: { name: true } } } });
  const tab = (label: string, href: string, active: boolean) => (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 text-sm", active ? "bg-primary text-primary-foreground" : "hover:bg-accent")}>
      {label}
    </Link>
  );
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{scope === "org" ? "My organization's requests" : "My requests"}</h1>
        <Button asChild>
          <Link href="/portal/new">New request</Link>
        </Button>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {tab("Open", `/portal/tickets?show=open&scope=${scope}`, show !== "closed")}
        {tab("Resolved & closed", `/portal/tickets?show=closed&scope=${scope}`, show === "closed")}
        {orgAccess && (
          <span className="ml-auto flex gap-2">
            {tab("Mine", `/portal/tickets?show=${show}&scope=mine`, scope !== "org")}
            {tab("My organization", `/portal/tickets?show=${show}&scope=org`, scope === "org")}
          </span>
        )}
      </div>
      <ul className="mt-4 divide-y rounded-lg border">
        {tickets.map((t) => (
          <li key={t.id}>
            <Link href={`/portal/tickets/${t.number}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-accent/40">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{t.title}</span>
                <span className="text-xs text-muted-foreground">
                  {t.number} · {t.type.name} · updated {formatDate(t.updatedAt, meta.timezone)}
                  {scope === "org" && ` · ${t.requester.name}`}
                </span>
              </span>
              <StatusBadge label={stateLabel(meta, t.type.key, t.status, true)} color={stateColor(meta, t.type.key, t.status)} category={t.statusCategory} />
            </Link>
          </li>
        ))}
        {tickets.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">No {show === "closed" ? "resolved" : "open"} requests.</li>}
      </ul>
    </div>
  );
}
