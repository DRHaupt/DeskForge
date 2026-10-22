import Link from "next/link";
import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { can } from "@/core/rbac/actor";
import { PageHeader } from "@/components/console/console-shell";
import { Pagination } from "@/components/console/pagination";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { requirePagePermission } from "@/server/session";
import { listRoles, listUsers, listOrganizations } from "@/server/services/admin";
import { NewUserDialog } from "./new-user-dialog";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("user.view", "/admin/users");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const active = sp.status === "inactive" ? false : sp.status === "all" ? undefined : true;
  const [result, roles, orgs] = await Promise.all([
    listUsers(actor, { q: sp.q, role: sp.role, active, page, pageSize: 25 }),
    listRoles(actor),
    can(actor, "org.view") ? listOrganizations(actor) : Promise.resolve([]),
  ]);
  const tz = getConfig().locale.timezone;

  return (
    <>
      <PageHeader
        title="Users"
        description="Agents, requesters and everyone in between."
        actions={can(actor, "user.manage") && <NewUserDialog roles={roles.map((r) => ({ key: r.key, name: r.name }))} organizations={orgs.map((o) => ({ id: o.id, name: o.name }))} />}
      />
      <form className="mb-4 flex flex-wrap gap-2" role="search" aria-label="Filter users">
        <Input name="q" defaultValue={sp.q} placeholder="Search name or email" className="max-w-xs" aria-label="Search name or email" />
        <select name="role" defaultValue={sp.role ?? ""} aria-label="Role" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? "active"} aria-label="Status" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="active">Active</option>
          <option value="inactive">Deactivated</option>
          <option value="all">All</option>
        </select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead className="hidden md:table-cell">Organization</TableHead>
              <TableHead className="hidden md:table-cell">Teams</TableHead>
              <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.items.map((u) => (
              <TableRow key={u.id} className={u.isActive ? "" : "opacity-60"}>
                <TableCell>
                  <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                    {u.name}
                  </Link>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r.role.key} variant="secondary">
                        {r.role.name}
                      </Badge>
                    ))}
                    {!u.isActive && <Badge variant="outline">Deactivated</Badge>}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">{u.organization?.name ?? "—"}</TableCell>
                <TableCell className="hidden md:table-cell text-sm">{u.teamMemberships.map((m) => m.team.name).join(", ") || "—"}</TableCell>
                <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">{formatDateTime(u.lastLoginAt, tz)}</TableCell>
              </TableRow>
            ))}
            {result.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No users match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      <Pagination page={page} pageSize={25} total={result.total} baseHref="/admin/users" params={{ q: sp.q, role: sp.role, status: sp.status }} />
    </>
  );
}
