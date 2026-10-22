import { describe, expect, it } from "vitest";
import type { Calendar } from "@/core/sla/calendar";
import { reconcileTimer, selectPolicy, type SlaPolicyLite, type TicketFacts, type Timer } from "@/core/sla/engine";

const always: Calendar = { timezone: "UTC", hours: [[], [], [], [], [], [], []], holidays: new Set(), always: true };
const t0 = new Date("2026-07-06T09:00:00Z");
const at = (mins: number) => new Date(t0.getTime() + mins * 60000);

const policy: SlaPolicyLite = { key: "p2", priorities: ["p2"], ticketTypes: [], firstResponseMins: 60, resolutionMins: 480, calendar: "ALWAYS", pauseStatuses: ["waiting"], warnAtPercent: 80, order: 0, isActive: true };
const facts = (over: Partial<TicketFacts> = {}): TicketFacts => ({ createdAt: t0, priority: "p2", typeKey: "incident", status: "open", category: "open", statePausesSla: false, firstRespondedAt: null, resolvedAt: null, ...over });

function run(metric: "FIRST_RESPONSE" | "RESOLUTION", steps: [number, Partial<TicketFacts>, SlaPolicyLite?][]): Timer {
  let timer: Timer | null = null;
  for (const [mins, f, p] of steps) timer = reconcileTimer(metric, timer, p ?? policy, facts(f), at(mins), always);
  return timer!;
}

describe("policy selection", () => {
  const policies = [
    { ...policy, key: "vip", ticketTypes: ["change"], order: 0 },
    { ...policy, key: "general", order: 1 },
    { ...policy, key: "off", priorities: ["p1"], isActive: false, order: 2 },
  ];
  it("matches priority and type in order", () => {
    expect(selectPolicy(policies, { priority: "p2", typeKey: "change" })?.key).toBe("vip");
    expect(selectPolicy(policies, { priority: "p2", typeKey: "incident" })?.key).toBe("general");
    expect(selectPolicy(policies, { priority: "p1", typeKey: "incident" })).toBeNull();
  });
});

describe("timers", () => {
  it("starts at creation with due and warning times", () => {
    const t = run("FIRST_RESPONSE", [[0, {}]]);
    expect(t.status).toBe("RUNNING");
    expect(t.dueAt).toEqual(at(60));
    expect(t.warnAt).toEqual(at(48));
  });

  it("stops as MET on first response in time, BREACHED when late", () => {
    expect(run("FIRST_RESPONSE", [[0, {}], [30, { firstRespondedAt: at(30) }]]).status).toBe("MET");
    const late = run("FIRST_RESPONSE", [[0, {}], [90, { firstRespondedAt: at(90) }]]);
    expect(late.status).toBe("BREACHED");
    expect(late.elapsedMins).toBe(90);
  });

  it("pauses in pause statuses and extends the due date", () => {
    const t = run("RESOLUTION", [
      [0, {}],
      [100, { status: "waiting", category: "pending" }],
      [400, { status: "open", category: "open" }], // paused for 300 min
    ]);
    expect(t.status).toBe("RUNNING");
    expect(t.dueAt).toEqual(at(480 + 300));
  });

  it("states with pausesSla also pause", () => {
    const t = run("RESOLUTION", [[0, {}], [10, { status: "scheduled", statePausesSla: true }]]);
    expect(t.status).toBe("PAUSED");
    expect(t.elapsedMins).toBe(10);
  });

  it("resolution stops on resolve and resumes on reopen", () => {
    const t = run("RESOLUTION", [
      [0, {}],
      [200, { status: "resolved", category: "resolved", resolvedAt: at(200) }],
      [300, { status: "open", category: "open" }],
    ]);
    expect(t.status).toBe("RUNNING");
    expect(t.dueAt).toEqual(at(300 + 280));
  });

  it("resolving without a public reply also stops first response", () => {
    const t = run("FIRST_RESPONSE", [[0, {}], [20, { category: "resolved", status: "resolved", resolvedAt: at(20) }]]);
    expect(t.status).toBe("MET");
  });

  it("recomputes when priority changes to a stricter policy, keeping elapsed time", () => {
    const p1 = { ...policy, key: "p1", priorities: ["p1"], resolutionMins: 240 };
    const t = run("RESOLUTION", [[0, {}], [100, { priority: "p1" }, p1]]);
    expect(t.targetMins).toBe(240);
    expect(t.dueAt).toEqual(at(240));
  });

  it("cancels when no policy applies anymore", () => {
    const t = reconcileTimer("RESOLUTION", run("RESOLUTION", [[0, {}]]), null, facts(), at(5), always);
    expect(t?.status).toBe("CANCELLED");
  });

  it("keeps the breach mark after reopening", () => {
    const t = run("RESOLUTION", [
      [0, {}],
      [600, { status: "resolved", category: "resolved", resolvedAt: at(600) }],
      [700, { status: "open", category: "open" }],
    ]);
    expect(t.status).toBe("RUNNING");
    expect(t.breachedAt).toBeTruthy();
  });

  it("does not create a timer when the metric has no target", () => {
    expect(reconcileTimer("FIRST_RESPONSE", null, { ...policy, firstResponseMins: null }, facts(), at(0), always)).toBeNull();
  });
});
