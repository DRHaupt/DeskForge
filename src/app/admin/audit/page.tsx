import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { PageHeader } from "@/components/console/console-shell";
import { Pagination } from "@/components/console/pagination";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { requirePagePermission } from "@/server/session";
import { listAuditLogs } from "@/server/services/admin";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("audit.view", "/admin/audit");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const result = await listAuditLogs(actor, { action: sp.action || undefined, entityType: sp.entityType || undefined, entityId: sp.entityId || undefined, page, pageSize: 50 });
  const tz = getConfig().locale.timezone;
  return (
    <>
      <PageHeader title="Audit log" description="Every change, who made it and from where." />
      <form className="mb-4 flex flex-wrap gap-2" role="search" aria-label="Filter audit log">
        <Input name="action" defaultValue={sp.action} placeholder="Action starts with… e.g. user." className="max-w-xs" aria-label="Action" />
        <Input name="entityType" defaultValue={sp.entityType} placeholder="Entity type" className="max-w-40" aria-label="Entity type" />
        <Input name="entityId" defaultValue={sp.entityId} placeholder="Entity id" className="max-w-56" aria-label="Entity id" />
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead className="hidden lg:table-cell">Changes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.items.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap text-sm">{formatDateTime(e.createdAt, tz)}</TableCell>
                <TableCell className="text-sm">
                  {e.actorLabel}
                  {e.ip && <div className="text-xs text-muted-foreground">{e.ip}</div>}
                </TableCell>
                <TableCell className="font-mono text-xs">{e.action}</TableCell>
                <TableCell className="text-sm">
                  {e.entityType}
                  {e.entityId && <div className="font-mono text-xs text-muted-foreground">{e.entityId}</div>}
                </TableCell>
                <TableCell className="hidden max-w-md lg:table-cell">
                  {e.changes ? <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{JSON.stringify(e.changes, null, 1)}</pre> : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Pagination page={page} pageSize={50} total={result.total} baseHref="/admin/audit" params={{ action: sp.action, entityType: sp.entityType, entityId: sp.entityId }} />
    </>
  );
}
