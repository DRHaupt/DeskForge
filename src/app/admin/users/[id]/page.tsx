import Link from "next/link";
import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { describePolicy } from "@/core/auth/password";
import { can } from "@/core/rbac/actor";
import { PageHeader } from "@/components/console/console-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { requirePagePermission } from "@/server/session";
import { getUser, listAuditLogs, listOrganizations, listRoles } from "@/server/services/admin";
import { EditUserForm } from "./edit-user-form";

export const metadata: Metadata = { title: "User" };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePagePermission("user.view", `/admin/users/${id}`);
  const cfg = getConfig();
  const [user, roles, orgs, history] = await Promise.all([
    getUser(actor, id),
    listRoles(actor),
    can(actor, "org.view") ? listOrganizations(actor) : Promise.resolve([]),
    can(actor, "audit.view") ? listAuditLogs(actor, { entityType: "user", entityId: id, page: 1, pageSize: 10 }) : Promise.resolve(null),
  ]);
  const tz = cfg.locale.timezone;

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/users" className="text-muted-foreground hover:underline">
          ← Users
        </Link>
      </p>
      <PageHeader title={user.name} description={user.email} actions={!user.isActive && <Badge variant="outline">Deactivated</Badge>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <EditUserForm
            user={{
              id: user.id,
              name: user.name,
              email: user.email,
              jobTitle: user.jobTitle,
              phone: user.phone,
              organizationId: user.organizationId,
              orgTicketAccess: user.orgTicketAccess,
              isActive: user.isActive,
              roleKeys: user.roles.map((r) => r.role.key),
              totpEnabled: user.totpEnabled,
              locked: Boolean(user.lockedUntil && user.lockedUntil > new Date()),
              isSelf: actor.id === user.id,
            }}
            roles={roles.map((r) => ({ key: r.key, name: r.name, description: r.description }))}
            organizations={orgs.map((o) => ({ id: o.id, name: o.name }))}
            canEdit={can(actor, "user.manage")}
            passwordHint={describePolicy(cfg.auth.local.passwordPolicy)}
          />
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Created:</span> {formatDateTime(user.createdAt, tz)}
              </p>
              <p>
                <span className="text-muted-foreground">Last sign-in:</span> {formatDateTime(user.lastLoginAt, tz)}
              </p>
              <p>
                <span className="text-muted-foreground">Sign-in methods:</span>{" "}
                {[user.hasPassword && "Password", ...user.identities.map((i) => i.provider)].filter(Boolean).join(", ") || "None yet"}
              </p>
              <p>
                <span className="text-muted-foreground">Two-factor:</span> {user.totpEnabled ? "Enabled" : "Off"}
              </p>
              <p>
                <span className="text-muted-foreground">Teams:</span>{" "}
                {user.teamMemberships.map((m) => `${m.team.name}${m.isLead ? " (lead)" : ""}`).join(", ") || "—"}
              </p>
            </CardContent>
          </Card>
          {history && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent changes</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {history.items.map((h) => (
                    <li key={h.id}>
                      <span className="font-medium">{h.action}</span> by {h.actorLabel}
                      <div className="text-xs text-muted-foreground">{formatDateTime(h.createdAt, tz)}</div>
                    </li>
                  ))}
                  {history.items.length === 0 && <li className="text-muted-foreground">No changes recorded.</li>}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
