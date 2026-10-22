import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { PageHeader } from "@/components/console/console-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import { requirePagePermission } from "@/server/session";
import { knownErrorFilter, listKnownErrors } from "@/server/services/problems";

export const metadata: Metadata = { title: "Known errors" };

export default async function KnownErrorsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const cfg = getConfig();
  if (!cfg.features.problemManagement) notFound();
  const actor = await requirePagePermission("ticket.comment_internal", "/agent/known-errors");
  const sp = await searchParams;
  const filter = knownErrorFilter.parse({ q: sp.q || undefined, includeResolved: sp.all === "1" ? "true" : undefined });
  const items = await listKnownErrors(actor, filter);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Known errors" description="Problems with a confirmed cause and a workaround. Link new incidents to them so requesters get help faster." />
      <form className="mb-4 flex flex-wrap items-center gap-2" role="search" aria-label="Search known errors">
        <Input name="q" defaultValue={filter.q} placeholder="Search symptoms, cause or workaround" className="max-w-sm" aria-label="Search known errors" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="all" value="1" defaultChecked={filter.includeResolved} /> Include resolved
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <div className="space-y-3">
        {items.map((k) => (
          <Card key={k.id} className="py-4">
            <CardContent className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/agent/tickets/${k.number}`} className="font-medium hover:underline">
                  {k.number} · {k.title}
                </Link>
                <Badge variant="outline">{k.status.replace(/_/g, " ")}</Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {k.incidentCount} linked incident{k.incidentCount === 1 ? "" : "s"} · updated {formatDateTime(k.updatedAt, cfg.locale.timezone)}
                </span>
              </div>
              {k.rootCause && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Cause: </span>
                  {k.rootCause}
                </p>
              )}
              <p className="whitespace-pre-wrap rounded-md bg-muted p-2 text-sm">
                <span className="font-medium">Workaround: </span>
                {k.workaround ?? "Not written yet."}
              </p>
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && <p className="text-muted-foreground">No known errors{filter.q ? " match that search" : " right now"}.</p>}
      </div>
    </div>
  );
}
