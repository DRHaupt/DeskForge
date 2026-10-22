import type { Metadata } from "next";
import { can } from "@/core/rbac/actor";
import { PageHeader } from "@/components/console/console-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/server/session";
import { listOrganizations } from "@/server/services/admin";
import { OrganizationDialog } from "./organization-dialog";

export const metadata: Metadata = { title: "Organizations" };

export default async function OrganizationsPage() {
  const actor = await requirePagePermission("org.view", "/admin/organizations");
  const orgs = await listOrganizations(actor);
  const manage = can(actor, "org.manage");
  return (
    <>
      <PageHeader
        title="Organizations"
        description="Customer companies. Requesters are linked automatically by email domain."
        actions={manage && <OrganizationDialog />}
      />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Domains</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Tickets</TableHead>
              {manage && (
                <TableHead>
                  <span className="sr-only">Edit</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {orgs.map((o) => (
              <TableRow key={o.id} className={o.isActive ? "" : "opacity-60"}>
                <TableCell className="font-medium">
                  {o.name} {!o.isActive && <Badge variant="outline">Inactive</Badge>}
                </TableCell>
                <TableCell className="text-sm">{o.domains.join(", ") || "—"}</TableCell>
                <TableCell className="text-sm">{o._count.users}</TableCell>
                <TableCell className="text-sm">{o._count.tickets}</TableCell>
                {manage && (
                  <TableCell className="text-right">
                    <OrganizationDialog org={{ id: o.id, name: o.name, slug: o.slug, domains: o.domains, phone: o.phone, notes: o.notes, isActive: o.isActive }} />
                  </TableCell>
                )}
              </TableRow>
            ))}
            {orgs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No organizations yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
