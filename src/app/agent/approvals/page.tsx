import Link from "next/link";
import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { PageHeader } from "@/components/console/console-shell";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { requireActor } from "@/server/session";
import { listMyApprovals } from "@/server/services/catalog";
import { DecideButtons } from "./decide";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const actor = await requireActor("/agent/approvals");
  const { show } = await searchParams;
  const decided = show === "decided";
  const items = await listMyApprovals(actor, decided ? "DECIDED" : "PENDING");
  const tz = getConfig().locale.timezone;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Approvals" description="Requests and changes waiting for your decision." />
      <div className="mb-4 flex gap-2 text-sm">
        <Link href="/agent/approvals" aria-current={!decided ? "page" : undefined} className={!decided ? "font-semibold" : "text-muted-foreground hover:underline"}>
          Waiting for me
        </Link>
        ·
        <Link href="/agent/approvals?show=decided" aria-current={decided ? "page" : undefined} className={decided ? "font-semibold" : "text-muted-foreground hover:underline"}>
          Decided
        </Link>
      </div>
      <div className="space-y-4">
        {items.map((a) => (
          <Card key={a.id}>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {a.kind === "CATALOG" ? "Service request" : "Change (CAB)"} · {a.ticket.number} · {formatDateTime(a.createdAt, tz)}
                  </p>
                  <Link href={`/agent/tickets/${a.ticket.number}`} className="text-lg font-semibold hover:underline">
                    {a.catalogRequest?.item.name ?? a.ticket.title}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    Requested by {a.ticket.requester.name}
                    {a.ticket.organization && ` · ${a.ticket.organization.name}`}
                  </p>
                </div>
                {decided && <span className={`text-sm font-medium ${a.status === "APPROVED" ? "text-green-700" : "text-destructive"}`}>{a.status.toLowerCase()}</span>}
              </div>
              <div className="prose-df rounded-md bg-muted/40 p-3" dangerouslySetInnerHTML={{ __html: a.ticket.description }} />
              {a.kind === "CHANGE_CAB" && (
                <dl className="grid gap-1 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="inline text-muted-foreground">Risk: </dt>
                    <dd className="inline">{a.ticket.riskLevel ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="inline text-muted-foreground">Window: </dt>
                    <dd className="inline">
                      {a.ticket.plannedStartAt ? formatDateTime(a.ticket.plannedStartAt, tz) : "—"} – {a.ticket.plannedEndAt ? formatDateTime(a.ticket.plannedEndAt, tz) : "—"}
                    </dd>
                  </div>
                </dl>
              )}
              {decided ? a.comment && <p className="text-sm">“{a.comment}”</p> : <DecideButtons id={a.id} />}
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && <p className="py-10 text-center text-muted-foreground">{decided ? "No decisions yet." : "Nothing is waiting for you."}</p>}
      </div>
    </div>
  );
}
