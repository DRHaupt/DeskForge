import type { Metadata } from "next";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { getConfig } from "@/core/config/loader";
import { compact, formatDuration, RANGE_PRESETS } from "@/core/reports/stats";
import { can } from "@/core/rbac/actor";
import { PageHeader } from "@/components/console/console-shell";
import { BarList, TrendChart } from "@/components/reports/charts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/session";
import { buildReport, reportFilterSchema } from "@/server/services/reports";

export const metadata: Metadata = { title: "Reports" };
const sel = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

function SlaStatus({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-muted-foreground">No data</span>;
  const [Icon, color, text] = rate >= 0.9 ? [CircleCheck, "var(--status-good)", "On target"] : rate >= 0.75 ? [TriangleAlert, "var(--status-warning)", "Below target"] : [CircleAlert, "var(--status-critical)", "Off target"];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Icon className="size-4" style={{ color }} aria-hidden />
      <span>{text}</span>
    </span>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePagePermission("report.view", "/agent/reports");
  const sp = await searchParams;
  const filter = reportFilterSchema.safeParse({ range: sp.range || undefined, team: sp.team || undefined, type: sp.type || undefined }).data ?? reportFilterSchema.parse({});
  const cfg = getConfig();
  const [r, teams] = await Promise.all([buildReport(actor, filter), db.team.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const canExport = can(actor, "report.export");
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();

  const tiles = [
    { label: "Tickets created", value: compact(r.totals.created) },
    { label: "Tickets resolved", value: compact(r.totals.resolved) },
    { label: "Open backlog now", value: compact(r.totals.backlog) },
    { label: "Median first response", value: formatDuration(r.responseTime.median), sub: `90% within ${formatDuration(r.responseTime.p90)}` },
    { label: "Median time to resolve", value: formatDuration(r.resolutionTime.median), sub: `90% within ${formatDuration(r.resolutionTime.p90)}` },
    ...(r.csat ? [{ label: "Customer satisfaction", value: r.csat.average === null ? "—" : `${r.csat.average.toFixed(1)} / ${r.csat.scale}`, sub: `${r.csat.responses} responses (${pct(r.csat.responseRate)} replied)` }] : []),
  ];

  return (
    <>
      <PageHeader
        title="Reports"
        description="How the help desk is doing. Times are wall-clock from when a ticket was opened."
        actions={
          canExport && (
            <div className="flex flex-wrap gap-2">
              {(["tickets", "summary", "agents", "sla"] as const).map((k) => (
                <Button key={k} asChild variant="outline" size="sm">
                  <a href={`/api/v1/reports/export/${k}?${qs}`} download>
                    {k === "tickets" ? "Tickets CSV" : k === "summary" ? "Daily CSV" : k === "agents" ? "Agents CSV" : "SLA CSV"}
                  </a>
                </Button>
              ))}
            </div>
          )
        }
      />
      <form className="mb-6 flex flex-wrap gap-2" aria-label="Report filters">
        <select name="range" defaultValue={filter.range} aria-label="Date range" className={sel}>
          {Object.entries(RANGE_PRESETS).map(([k, d]) => (
            <option key={k} value={k}>
              Last {d} days
            </option>
          ))}
        </select>
        <select name="team" defaultValue={filter.team ?? ""} aria-label="Team" className={sel}>
          <option value="">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select name="type" defaultValue={filter.type ?? ""} aria-label="Ticket type" className={sel}>
          <option value="">All ticket types</option>
          {cfg.ticketTypes.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <Card key={t.label} className="gap-1 py-4">
            <CardHeader className="px-4">
              <CardDescription>{t.label}</CardDescription>
              <CardTitle className="text-2xl font-semibold">{t.value}</CardTitle>
            </CardHeader>
            {t.sub && <CardContent className="px-4 text-xs text-muted-foreground">{t.sub}</CardContent>}
          </Card>
        ))}
      </div>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Created and resolved per day</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart
              label="Tickets created and resolved per day"
              days={r.days}
              series={[
                { name: "Created", values: r.series.created, color: "var(--series-1)" },
                { name: "Resolved", values: r.series.resolved, color: "var(--series-2)" },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SLA compliance</CardTitle>
            <CardDescription>Targets met vs breached in this period. Target: 90%.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(
              [
                ["First response", r.sla.firstResponse],
                ["Resolution", r.sla.resolution],
              ] as const
            ).map(([name, s]) => (
              <div key={name} className="flex items-center justify-between gap-2 border-b pb-3 last:border-0">
                <div>
                  <p className="text-sm text-muted-foreground">{name}</p>
                  <p className="text-2xl font-semibold">{pct(s.rate)}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.met} met · {s.breached} breached
                  </p>
                </div>
                <SlaStatus rate={s.rate} />
              </div>
            ))}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Priority</TableHead>
                  <TableHead className="text-right">Met</TableHead>
                  <TableHead className="text-right">Breached</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="tabular-nums">
                {r.sla.byPriority.map((p) => (
                  <TableRow key={p.key}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell className="text-right">{p.met}</TableCell>
                    <TableCell className="text-right">{p.breached}</TableCell>
                    <TableCell className="text-right">{pct(p.rate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open backlog by team</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList label="Open backlog by team" rows={r.backlog.byTeam} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open backlog by priority</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList label="Open backlog by priority" rows={r.backlog.byPriority} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Created by type</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList label="Tickets created by type" rows={r.byType} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Created by channel</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList label="Tickets created by channel" rows={r.bySource} />
          </CardContent>
        </Card>
      </div>

      <div className={`mt-6 grid gap-6 ${r.csat ? "xl:grid-cols-[2fr_1fr]" : ""}`}>
        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle className="text-base">Agents</CardTitle>
            <CardDescription>Open tickets now; resolved, time to resolve and satisfaction in this period. Reopened: {pct(r.totals.reopenRate)} of resolved tickets.</CardDescription>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Resolved</TableHead>
                <TableHead className="text-right">Median to resolve</TableHead>
                {r.csat && <TableHead className="text-right">CSAT</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {r.agents.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.name}</TableCell>
                  <TableCell className="text-right">{a.open}</TableCell>
                  <TableCell className="text-right">{a.resolved}</TableCell>
                  <TableCell className="text-right">{formatDuration(a.medianResolutionMins)}</TableCell>
                  {r.csat && <TableCell className="text-right">{a.csat === null ? "—" : `${a.csat.toFixed(1)} (${a.csatResponses})`}</TableCell>}
                </TableRow>
              ))}
              {r.agents.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    No assigned tickets in this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
        {r.csat && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Satisfaction ratings</CardTitle>
              <CardDescription>
                {r.csat.responses} of {r.csat.sent} surveys answered
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BarList label="Satisfaction ratings" rows={[...r.csat.distribution].reverse().map((d) => ({ label: `${d.rating} ${d.rating === 1 ? "star" : "stars"}`, n: d.n }))} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
