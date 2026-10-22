import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/server/session", () => ({ getCurrentActor: async () => null }));

import { db } from "@/server/db";
import { buildReport, exportReportCsv } from "@/server/services/reports";
import { createTicket, transitionTicket, addComment } from "@/server/services/tickets";
import { GET as exportRoute } from "@/app/api/v1/reports/export/[kind]/route";
import { ForbiddenError } from "@/core/errors";
import { parseCsv } from "@/core/assets/csv";
import type { UserActor } from "@/core/rbac/actor";
import { actorFor, apiKeyFor, makeUser, params, req, setupBusiness } from "./helpers";

let lead: UserActor, agent: UserActor, requester: UserActor, auditor: UserActor;
let auditorKey: string, agentKey: string;

beforeAll(async () => {
  await setupBusiness("msp-it-support");
  const l = await makeUser("lead@northbeam-it.example", ["team_lead"], { name: "Lead" });
  const a = await makeUser("mia.chen@northbeam-it.example", ["agent"], { name: "Mia Chen" });
  const r = await makeUser("pat@acmedental.example", ["requester"], { name: "Pat" });
  const au = await makeUser("audit@northbeam-it.example", ["auditor"], { name: "Auditor" });
  [lead, agent, requester, auditor] = await Promise.all([actorFor(l.id), actorFor(a.id), actorFor(r.id), actorFor(au.id)]);
  auditorKey = await apiKeyFor(au.id);
  agentKey = await apiKeyFor(a.id);

  // Three incidents: one answered and resolved, one answered, one untouched.
  const t1 = await createTicket(requester, { type: "incident", title: "Printer offline" });
  const t2 = await createTicket(requester, { type: "incident", title: "VPN slow" });
  await createTicket(requester, { type: "incident", title: "New monitor flickers" });
  for (const t of [t1, t2]) {
    await db.ticket.update({ where: { id: t.id }, data: { assigneeId: lead.id } });
    await addComment(lead, t.id, { body: "<p>On it</p>", visibility: "PUBLIC" });
  }
  await transitionTicket(lead, t1.id, { to: "resolved", comment: "<p>Fixed</p>" });
});

describe("reports", () => {
  it("summarises volumes, times and agents", async () => {
    const r = await buildReport(lead, { range: "7d" });
    expect(r.days).toHaveLength(7);
    expect(r.totals).toMatchObject({ created: 3, resolved: 1, backlog: 2 });
    expect(r.series.created.at(-1)).toBe(3);
    expect(r.responseTime.n).toBe(2);
    expect(r.resolutionTime.n).toBe(1);
    expect(r.agents).toEqual([expect.objectContaining({ name: "Lead", open: 1, resolved: 1 })]);
    expect(r.backlog.byPriority.reduce((a, b) => a + b.n, 0)).toBe(2);
    expect(r.csat).not.toBeNull();
  });

  it("filters by team and type", async () => {
    const team = await db.team.findUniqueOrThrow({ where: { key: "systems" } });
    expect((await buildReport(lead, { range: "7d", team: team.id })).totals.created).toBe(0);
    expect((await buildReport(lead, { range: "7d", type: "change" })).totals.created).toBe(0);
  });

  it("requires report permissions", async () => {
    await expect(buildReport(agent, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(buildReport(requester, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(buildReport(auditor, {})).resolves.toBeTruthy();
    const denied = await exportRoute(req("/api/v1/reports/export/tickets", { key: agentKey }), params({ kind: "tickets" }));
    expect(denied.status).toBe(403);
  });

  it("exports CSV", async () => {
    const res = await exportRoute(req("/api/v1/reports/export/tickets?range=7d", { key: auditorKey }), params({ kind: "tickets" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("tickets-7d-");
    const rows = parseCsv(await res.text());
    expect(rows[0]).toContain("number");
    expect(rows).toHaveLength(4);
    const agents = parseCsv(await exportReportCsv(auditor, "agents", { range: "7d" }));
    expect(agents[1]![0]).toBe("Lead");
    const daily = parseCsv(await exportReportCsv(auditor, "summary", { range: "30d" }));
    expect(daily).toHaveLength(31);
    expect((await exportRoute(req("/api/v1/reports/export/bogus", { key: auditorKey }), params({ kind: "bogus" }))).status).toBe(400);
  });
});
