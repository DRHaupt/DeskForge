import Link from "next/link";
import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { PageHeader } from "@/components/console/console-shell";
import { StatusBadge } from "@/components/tickets/badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { buildTicketMeta, stateColor, stateLabel } from "@/lib/ticket-meta";
import { db } from "@/server/db";
import { requireAgent } from "@/server/session";
import { filterWhere, listTickets, ticketFilterSchema } from "@/server/services/tickets";
import { RelativeTime } from "@/components/relative-time";

export const metadata: Metadata = { title: "Home" };

export default async function AgentHome() {
  const actor = await requireAgent();
  const meta = buildTicketMeta(getConfig());
  const count = (f: Record<string, string>) => db.ticket.count({ where: filterWhere(actor, ticketFilterSchema.parse(f)) });
  const now = new Date();
  const [mine, unassigned, openAll, breached, recent] = await Promise.all([
    count({ assignee: "me", open: "true" }),
    count({ assignee: "none", open: "true" }),
    count({ open: "true" }),
    db.sLAInstance.count({ where: { breachedAt: { not: null }, status: { in: ["RUNNING", "PAUSED"] }, ticket: { AND: [filterWhere(actor, { open: "true" }), { assigneeId: actor.id }] } } }),
    listTickets(actor, ticketFilterSchema.parse({ assignee: "me", open: "true", pageSize: "8" })),
  ]);
  const stats = [
    { label: "Assigned to me", value: mine, href: "/agent/tickets?view=mine" },
    { label: "Unassigned in my queues", value: unassigned, href: "/agent/tickets?view=unassigned" },
    { label: "Open tickets I can see", value: openAll, href: "/agent/tickets?view=open" },
    { label: "My SLA breaches", value: breached, href: "/agent/tickets?view=mine&sort=due" },
  ];
  const hour = Number(new Intl.DateTimeFormat("en", { hour: "numeric", hour12: false, timeZone: meta.timezone }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader title={`${greeting}, ${actor.name.split(" ")[0]}`} description="Here's what needs your attention." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="rounded-xl focus-visible:outline-2">
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader>
                <CardDescription>{s.label}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{s.value}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">My open tickets</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {recent.items.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <Link href={`/agent/tickets/${t.number}`} className="min-w-0 flex-1 truncate hover:underline">
                  <span className="mr-2 font-mono text-xs text-muted-foreground">{t.number}</span>
                  {t.title}
                </Link>
                <StatusBadge label={stateLabel(meta, t.type.key, t.status)} color={stateColor(meta, t.type.key, t.status)} category={t.statusCategory} />
                <span className="w-24 text-right text-xs text-muted-foreground"><RelativeTime date={t.updatedAt} /></span>
              </li>
            ))}
            {recent.items.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">Nothing assigned to you. 🎉</li>}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
