import Link from "next/link";
import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { PageHeader } from "@/components/console/console-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";
import { requirePagePermission } from "@/server/session";

export const metadata: Metadata = { title: "Email log" };

const TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  SENT: "secondary",
  QUEUED: "outline",
  FAILED: "destructive",
  SKIPPED: "outline",
  CREATED_TICKET: "secondary",
  APPENDED_COMMENT: "secondary",
  IGNORED: "outline",
  RECEIVED: "outline",
};

export default async function EmailLogPage() {
  await requirePagePermission("config.view", "/admin/email");
  const cfg = getConfig();
  const env = getEnv();
  const [outbound, inbound] = await Promise.all([
    db.outboundEmail.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { ticket: { select: { number: true } } } }),
    db.inboundEmail.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { ticket: { select: { number: true } } } }),
  ]);
  const tz = cfg.locale.timezone;
  return (
    <>
      <PageHeader title="Email log" description="Recent outbound notifications and inbound mail. Use this to troubleshoot delivery and threading." />
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card className="gap-1 py-4">
          <CardContent className="px-4 text-sm">
            <p className="text-muted-foreground">Email module</p>
            <p className="font-medium">{cfg.email.enabled ? "Enabled" : "Disabled (email.enabled: false)"}</p>
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardContent className="px-4 text-sm">
            <p className="text-muted-foreground">Outbound SMTP</p>
            <p className="font-medium">{env.SMTP_HOST ? `${env.SMTP_HOST}:${env.SMTP_PORT}` : "Not configured — emails are logged only"}</p>
          </CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardContent className="px-4 text-sm">
            <p className="text-muted-foreground">Inbound mailboxes</p>
            <p className="font-medium">{cfg.email.mailboxes.map((m) => `${m.address} (${m.mode})`).join(", ") || "None"}</p>
          </CardContent>
        </Card>
      </div>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Outbound</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outbound.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm whitespace-nowrap">{formatDateTime(m.createdAt, tz)}</TableCell>
                  <TableCell className="text-sm">{m.toAddress}{m.ccAddress.length > 0 && <span className="text-muted-foreground"> +{m.ccAddress.length} cc</span>}</TableCell>
                  <TableCell className="max-w-xs truncate text-sm">
                    {m.ticket ? <Link href={`/agent/tickets/${m.ticket.number}`} className="hover:underline">{m.subject}</Link> : m.subject}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{m.kind}</TableCell>
                  <TableCell>
                    <Badge variant={TONE[m.status] ?? "outline"} title={m.error ?? undefined}>{m.status.toLowerCase()}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {outbound.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No outbound email yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Inbound</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inbound.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-sm whitespace-nowrap">{formatDateTime(m.createdAt, tz)}</TableCell>
                  <TableCell className="text-sm">{m.fromEmail}</TableCell>
                  <TableCell className="max-w-xs truncate text-sm">{m.subject}</TableCell>
                  <TableCell className="text-sm">
                    <Badge variant={TONE[m.status] ?? "outline"}>{m.status.toLowerCase().replace(/_/g, " ")}</Badge>{" "}
                    {m.ticket && <Link href={`/agent/tickets/${m.ticket.number}`} className="text-xs hover:underline">{m.ticket.number}</Link>}
                    {m.error && <span className="block text-xs text-muted-foreground">{m.error}</span>}
                  </TableCell>
                </TableRow>
              ))}
              {inbound.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">No inbound email yet.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
