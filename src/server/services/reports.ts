/**
 * Reporting: volumes, response and resolution times, SLA compliance, backlog,
 * agent workload and CSAT for a date range. Reports cover the whole help desk
 * (`report.view`), optionally narrowed to one team and/or ticket type.
 * Merged and deleted tickets are excluded everywhere.
 */
import { z } from "zod";
import { getConfig } from "@/core/config/loader";
import { dayKeys, fillSeries, percentile, RANGE_PRESETS, ratio, startOfLocalDay } from "@/core/reports/stats";
import { toCsv } from "@/core/assets/csv";
import { assertCan, type Actor } from "@/core/rbac/actor";
import { Prisma } from "@/generated/prisma/client";
import { db } from "../db";

export const reportFilterSchema = z.object({
  range: z.enum(Object.keys(RANGE_PRESETS) as [keyof typeof RANGE_PRESETS, ...(keyof typeof RANGE_PRESETS)[]]).default("30d"),
  team: z.string().max(64).optional(),
  type: z.string().max(60).optional(),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;

/** The last N local days (today included), in the business time zone. */
function window(f: ReportFilter, now = new Date()) {
  const days = RANGE_PRESETS[f.range];
  return { from: startOfLocalDay(now, days - 1, getConfig().locale.timezone), to: now, days };
}

/** SQL fragment restricting tickets aliased `t`. */
function ticketScope(f: ReportFilter): Prisma.Sql {
  const parts = [Prisma.sql`t.deleted_at IS NULL`, Prisma.sql`t.merged_into_id IS NULL`];
  if (f.team) parts.push(Prisma.sql`t.team_id = ${f.team}`);
  if (f.type) parts.push(Prisma.sql`t.type_id = (SELECT id FROM ticket_types WHERE key = ${f.type})`);
  return Prisma.join(parts, " AND ");
}

const mins = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

export async function buildReport(actor: Actor, raw: z.input<typeof reportFilterSchema>) {
  assertCan(actor, "report.view");
  const f = reportFilterSchema.parse(raw);
  const cfg = getConfig();
  const tz = cfg.locale.timezone;
  const { from, to } = window(f);
  const scope = ticketScope(f);
  const keys = dayKeys(from, to, tz);

  const [createdDaily, resolvedDaily, responseRows, resolutionRows, sla, backlogByTeam, backlogByPriority, byType, bySource, agents, csat, reopened] = await Promise.all([
    db.$queryRaw<{ day: string; n: number }[]>`
      SELECT to_char(t.created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM tickets t WHERE ${scope} AND t.created_at >= ${from} AND t.created_at <= ${to} GROUP BY 1`,
    db.$queryRaw<{ day: string; n: number }[]>`
      SELECT to_char(t.resolved_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM tickets t WHERE ${scope} AND t.resolved_at >= ${from} AND t.resolved_at <= ${to} GROUP BY 1`,
    db.$queryRaw<{ c: Date; r: Date }[]>`
      SELECT t.created_at AS c, t.first_responded_at AS r FROM tickets t
      WHERE ${scope} AND t.created_at >= ${from} AND t.created_at <= ${to} AND t.first_responded_at IS NOT NULL`,
    db.$queryRaw<{ c: Date; r: Date }[]>`
      SELECT t.created_at AS c, t.resolved_at AS r FROM tickets t
      WHERE ${scope} AND t.resolved_at >= ${from} AND t.resolved_at <= ${to}`,
    db.$queryRaw<{ metric: string; priority: string; met: number; breached: number }[]>`
      SELECT s.metric::text AS metric, t.priority,
        count(*) FILTER (WHERE s.status = 'MET' AND s.breached_at IS NULL)::int AS met,
        count(*) FILTER (WHERE s.breached_at IS NOT NULL)::int AS breached
      FROM sla_instances s JOIN tickets t ON t.id = s.ticket_id
      WHERE ${scope} AND s.status <> 'CANCELLED'
        AND ((s.stopped_at >= ${from} AND s.stopped_at <= ${to}) OR (s.breached_at >= ${from} AND s.breached_at <= ${to}))
      GROUP BY 1, 2`,
    db.$queryRaw<{ label: string | null; n: number }[]>`
      SELECT tm.name AS label, count(*)::int AS n FROM tickets t LEFT JOIN teams tm ON tm.id = t.team_id
      WHERE ${scope} AND t.status_category IN ('NEW', 'OPEN', 'PENDING') GROUP BY 1 ORDER BY 2 DESC`,
    db.$queryRaw<{ key: string; n: number }[]>`
      SELECT t.priority AS key, count(*)::int AS n FROM tickets t
      WHERE ${scope} AND t.status_category IN ('NEW', 'OPEN', 'PENDING') GROUP BY 1`,
    db.$queryRaw<{ label: string; n: number }[]>`
      SELECT y.name AS label, count(*)::int AS n FROM tickets t JOIN ticket_types y ON y.id = t.type_id
      WHERE ${scope} AND t.created_at >= ${from} AND t.created_at <= ${to} GROUP BY 1 ORDER BY 2 DESC`,
    db.$queryRaw<{ label: string; n: number }[]>`
      SELECT t.source::text AS label, count(*)::int AS n FROM tickets t
      WHERE ${scope} AND t.created_at >= ${from} AND t.created_at <= ${to} GROUP BY 1 ORDER BY 2 DESC`,
    db.$queryRaw<{ id: string; name: string; open: number; resolved: number; median_mins: number | null; csat: number | null; csat_n: number }[]>`
      SELECT u.id, u.name,
        count(*) FILTER (WHERE t.status_category IN ('NEW', 'OPEN', 'PENDING'))::int AS open,
        count(*) FILTER (WHERE t.resolved_at >= ${from} AND t.resolved_at <= ${to})::int AS resolved,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t.resolved_at - t.created_at) / 60)
          FILTER (WHERE t.resolved_at >= ${from} AND t.resolved_at <= ${to}) AS median_mins,
        avg(c.rating) FILTER (WHERE c.responded_at >= ${from} AND c.responded_at <= ${to})::float AS csat,
        count(c.rating) FILTER (WHERE c.responded_at >= ${from} AND c.responded_at <= ${to})::int AS csat_n
      FROM tickets t JOIN users u ON u.id = t.assignee_id LEFT JOIN csat_responses c ON c.ticket_id = t.id
      WHERE ${scope}
      GROUP BY u.id, u.name
      HAVING count(*) FILTER (WHERE t.status_category IN ('NEW', 'OPEN', 'PENDING')) > 0
          OR count(*) FILTER (WHERE t.resolved_at >= ${from} AND t.resolved_at <= ${to}) > 0
      ORDER BY resolved DESC, open DESC`,
    db.$queryRaw<{ rating: number; n: number }[]>`
      SELECT c.rating, count(*)::int AS n FROM csat_responses c JOIN tickets t ON t.id = c.ticket_id
      WHERE ${scope} AND c.rating IS NOT NULL AND c.responded_at >= ${from} AND c.responded_at <= ${to} GROUP BY 1`,
    db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM tickets t WHERE ${scope} AND t.resolved_at >= ${from} AND t.resolved_at <= ${to} AND t.reopen_count > 0`,
  ]);

  const csatSent = cfg.features.csat
    ? await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM csat_responses c JOIN tickets t ON t.id = c.ticket_id WHERE ${scope} AND c.sent_at >= ${from} AND c.sent_at <= ${to}`
    : [{ n: 0 }];

  const response = responseRows.map((r) => mins(r.c, r.r));
  const resolution = resolutionRows.map((r) => mins(r.c, r.r));
  const created = fillSeries(keys, createdDaily);
  const resolved = fillSeries(keys, resolvedDaily);
  const slaTotals = (metric: string) => {
    const rows = sla.filter((s) => s.metric === metric);
    const met = rows.reduce((a, r) => a + r.met, 0);
    const breached = rows.reduce((a, r) => a + r.breached, 0);
    return { met, breached, rate: ratio(met, met + breached) };
  };
  const priorityName = new Map(cfg.priorities.levels.map((p) => [p.key, p.name]));
  const csatCount = csat.reduce((a, r) => a + r.n, 0);
  const csatSum = csat.reduce((a, r) => a + r.rating * r.n, 0);

  return {
    filter: f,
    from: from.toISOString(),
    to: to.toISOString(),
    days: keys,
    totals: {
      created: created.reduce((a, b) => a + b, 0),
      resolved: resolved.reduce((a, b) => a + b, 0),
      backlog: backlogByPriority.reduce((a, r) => a + r.n, 0),
      reopenRate: ratio(reopened[0]?.n ?? 0, resolution.length),
    },
    series: { created, resolved },
    responseTime: { median: percentile(response, 0.5), p90: percentile(response, 0.9), n: response.length },
    resolutionTime: { median: percentile(resolution, 0.5), p90: percentile(resolution, 0.9), n: resolution.length },
    sla: {
      firstResponse: slaTotals("FIRST_RESPONSE"),
      resolution: slaTotals("RESOLUTION"),
      byPriority: cfg.priorities.levels.map((p) => {
        const rows = sla.filter((s) => s.priority === p.key);
        const met = rows.reduce((a, r) => a + r.met, 0);
        const breached = rows.reduce((a, r) => a + r.breached, 0);
        return { key: p.key, name: p.name, met, breached, rate: ratio(met, met + breached) };
      }),
    },
    backlog: {
      byTeam: backlogByTeam.map((r) => ({ label: r.label ?? "No team", n: r.n })),
      byPriority: cfg.priorities.levels.map((p) => ({ label: p.name, n: backlogByPriority.find((r) => r.key === p.key)?.n ?? 0 })),
    },
    byType: byType,
    bySource: bySource.map((r) => ({ label: r.label.charAt(0) + r.label.slice(1).toLowerCase(), n: r.n })),
    agents: agents.map((a) => ({ id: a.id, name: a.name, open: a.open, resolved: a.resolved, medianResolutionMins: a.median_mins === null ? null : Number(a.median_mins), csat: a.csat, csatResponses: a.csat_n })),
    csat: cfg.features.csat
      ? {
          scale: cfg.csat.scale,
          average: csatCount ? csatSum / csatCount : null,
          responses: csatCount,
          sent: csatSent[0]?.n ?? 0,
          responseRate: ratio(csatCount, csatSent[0]?.n ?? 0),
          distribution: Array.from({ length: cfg.csat.scale }, (_, i) => ({ rating: i + 1, n: csat.find((r) => r.rating === i + 1)?.n ?? 0 })),
        }
      : null,
    priorityName: Object.fromEntries(priorityName),
  };
}
export type Report = Awaited<ReturnType<typeof buildReport>>;

// ─── CSV exports ───────────────────────────────────────────────────────────

export const EXPORTS = ["summary", "agents", "sla", "tickets"] as const;
export type ExportKind = (typeof EXPORTS)[number];

const pct = (r: number | null) => (r === null ? "" : (r * 100).toFixed(1));
const round = (m: number | null) => (m === null ? "" : Math.round(m));

export async function exportReportCsv(actor: Actor, kind: ExportKind, raw: z.input<typeof reportFilterSchema>): Promise<string> {
  assertCan(actor, "report.export");
  if (kind === "tickets") return exportTickets(actor, raw);
  const r = await buildReport(actor, raw);
  if (kind === "summary") {
    return toCsv(
      ["date", "created", "resolved"],
      r.days.map((d, i) => [d, r.series.created[i], r.series.resolved[i]]),
    );
  }
  if (kind === "agents") {
    return toCsv(
      ["agent", "open_now", "resolved", "median_resolution_minutes", "csat_average", "csat_responses"],
      r.agents.map((a) => [a.name, a.open, a.resolved, round(a.medianResolutionMins), a.csat === null ? "" : a.csat.toFixed(2), a.csatResponses]),
    );
  }
  return toCsv(
    ["priority", "met", "breached", "compliance_percent"],
    r.sla.byPriority.map((p) => [p.name, p.met, p.breached, pct(p.rate)]),
  );
}

/** Raw ticket rows for the range (created in range), for analysis in a spreadsheet. */
async function exportTickets(actor: Actor, raw: z.input<typeof reportFilterSchema>): Promise<string> {
  const f = reportFilterSchema.parse(raw);
  const { from, to } = window(f);
  const rows = await db.ticket.findMany({
    where: {
      deletedAt: null,
      mergedIntoId: null,
      createdAt: { gte: from, lte: to },
      ...(f.team ? { teamId: f.team } : {}),
      ...(f.type ? { type: { key: f.type } } : {}),
    },
    select: {
      number: true, title: true, status: true, statusCategory: true, priority: true, source: true, createdAt: true, firstRespondedAt: true, resolvedAt: true, closedAt: true, reopenCount: true,
      type: { select: { name: true } }, team: { select: { name: true } }, assignee: { select: { name: true } }, requester: { select: { email: true } }, organization: { select: { name: true } },
      slaInstances: { where: { breachedAt: { not: null } }, select: { metric: true } },
      csatResponse: { select: { rating: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 100_000,
  });
  return toCsv(
    ["number", "type", "title", "status", "status_category", "priority", "source", "team", "assignee", "requester", "organization", "created_at", "first_response_at", "resolved_at", "closed_at", "reopen_count", "sla_breached", "csat"],
    rows.map((t) => [
      t.number, t.type.name, t.title, t.status, t.statusCategory.toLowerCase(), t.priority, t.source.toLowerCase(), t.team?.name, t.assignee?.name, t.requester.email, t.organization?.name,
      t.createdAt, t.firstRespondedAt, t.resolvedAt, t.closedAt, t.reopenCount, t.slaInstances.map((s) => s.metric.toLowerCase()).join(" "), t.csatResponse?.rating,
    ]),
  );
}

