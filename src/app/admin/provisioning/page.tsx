import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/console/console-shell";
import { RelativeTime } from "@/components/relative-time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { provisioningOverview } from "@/server/scim";
import { requirePagePermission } from "@/server/session";
import { CopyField, TokenActions } from "./provisioning-actions";

export const metadata: Metadata = { title: "Provisioning" };

const ACTION_LABELS: Record<string, string> = {
  "scim.user_created": "Created",
  "scim.user_linked": "Linked to existing account",
  "scim.user_updated": "Updated",
  "scim.user_deactivated": "Deactivated",
  "scim.user_reactivated": "Reactivated",
  "scim.token_created": "Token created",
  "scim.token_rotated": "Token replaced",
  "scim.token_revoked": "Token revoked",
};

export default async function ProvisioningPage() {
  const actor = await requirePagePermission("user.manage", "/admin/provisioning");
  const o = await provisioningOverview(actor);
  return (
    <>
      <PageHeader title="Provisioning" description="Keep accounts in sync with your identity provider (SCIM 2.0). New people get an account, changes are copied over, and people who are disabled or removed lose access." />
      {!o.enabled && (
        <Alert className="mb-4">
          <AlertTitle>Provisioning is turned off</AlertTitle>
          <AlertDescription>
            Add <code>scim: {"{ enabled: true }"}</code> to business.config.yaml and restart the app. You can create the token now; it starts working once provisioning is on.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Connection details</CardTitle>
            <CardDescription>
              In Microsoft Entra: Enterprise applications → your DeskForge app → Provisioning → Automatic. Paste these into Admin Credentials, then click Test Connection.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CopyField label="Tenant URL" value={o.tenantUrl} />
            <div className="space-y-1.5">
              <div className="text-sm font-medium">Secret token</div>
              <TokenActions hasToken={Boolean(o.token)} />
              {o.token && (
                <p className="text-xs text-muted-foreground">
                  Created <RelativeTime date={o.token.createdAt.toString()} />
                  {o.token.createdBy ? ` by ${o.token.createdBy}` : ""}. Tokens are shown once; generate a new one if it&apos;s lost.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>From business.config.yaml (scim section).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              {o.enabled ? <Badge>On</Badge> : <Badge variant="outline">Off</Badge>}
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Role for new people</span>
              <span>{o.defaultRole}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Send welcome email</span>
              <span>{o.sendWelcomeEmail ? "Yes" : "No"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Provisioned accounts</span>
              <span>
                {o.counts.active} active / {o.counts.provisioned}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
      <h2 className="mt-8 mb-3 text-base font-semibold">Recent activity</h2>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>What</TableHead>
              <TableHead>Person</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {o.recent.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="text-sm text-muted-foreground">
                  <RelativeTime date={r.createdAt.toISOString()} />
                </TableCell>
                <TableCell>{ACTION_LABELS[r.action] ?? r.action}</TableCell>
                <TableCell>
                  {r.user ? (
                    <Link href={`/admin/users/${r.user.id}`} className="hover:underline">
                      {r.user.name} <span className="text-xs text-muted-foreground">{r.user.email}</span>
                    </Link>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
            {o.recent.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  Nothing yet. Entra provisions on a cycle of about 40 minutes; use &quot;Provision on demand&quot; in Entra to test one person straight away.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
