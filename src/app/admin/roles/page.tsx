import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/console/console-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ALL_PERMISSIONS } from "@/core/rbac/permissions";
import { requirePagePermission } from "@/server/session";
import { listRoles } from "@/server/services/admin";
import { NewRoleDialog } from "./new-role-dialog";

export const metadata: Metadata = { title: "Roles" };

export default async function RolesPage() {
  const actor = await requirePagePermission("role.manage", "/admin/roles");
  const roles = await listRoles(actor);
  return (
    <>
      <PageHeader
        title="Roles"
        description="Roles bundle permissions. Every API route checks these permissions on the server."
        actions={<NewRoleDialog roles={roles.map((r) => ({ id: r.id, name: r.name, permissions: r.permissions }))} />}
      />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Permissions</TableHead>
              <TableHead>Users</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/admin/roles/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>{" "}
                  {r.isSystem && <Badge variant="outline">Built-in</Badge>}
                  <div className="max-w-md text-xs text-muted-foreground">{r.description}</div>
                </TableCell>
                <TableCell className="text-sm">{r.permissions.includes("*") ? "All" : `${r.permissions.length} of ${ALL_PERMISSIONS.length}`}</TableCell>
                <TableCell className="text-sm">{r._count.users}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
