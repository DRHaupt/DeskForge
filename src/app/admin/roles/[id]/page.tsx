import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/console/console-shell";
import { Badge } from "@/components/ui/badge";
import { ALL_PERMISSIONS, PERMISSIONS, permissionGroup } from "@/core/rbac/permissions";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/session";
import { RoleEditor } from "./role-editor";

export const metadata: Metadata = { title: "Role" };

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePagePermission("role.manage", `/admin/roles/${id}`);
  const role = await db.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!role) notFound();
  const groups: Record<string, { key: string; label: string; grantable: boolean }[]> = {};
  for (const p of ALL_PERMISSIONS) {
    (groups[permissionGroup(p)] ??= []).push({ key: p, label: PERMISSIONS[p], grantable: actor.permissions.has(p) });
  }
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/roles" className="text-muted-foreground hover:underline">
          ← Roles
        </Link>
      </p>
      <PageHeader
        title={role.name}
        description={`Key: ${role.key} · ${role._count.users} user(s)`}
        actions={role.isSystem && <Badge variant="outline">Built-in</Badge>}
      />
      <RoleEditor
        role={{ id: role.id, name: role.name, description: role.description, permissions: role.permissions, isSystem: role.isSystem, userCount: role._count.users }}
        groups={Object.entries(groups)}
      />
    </>
  );
}
