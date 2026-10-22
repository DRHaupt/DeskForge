import { describe, expect, it } from "vitest";
import { fieldSchema } from "@/core/config/schema";
import { buildFieldValuesSchema, displayValue, fromStorage, toStorage } from "@/core/tickets/fields";
import { pickAssignee, type Candidate } from "@/core/assignment/assign";
import { canSeeInternal, canViewTicket } from "@/core/tickets/access";
import { expandPermissions, BUILT_IN_ROLES } from "@/core/rbac/roles";
import type { UserActor } from "@/core/rbac/actor";
import { extractMentionIds } from "@/core/text/mentions";

const fields = [
  { key: "order", label: "Order", type: "text", required: true },
  { key: "reason", label: "Reason", type: "dropdown", options: ["Faulty", "Too big"], required: true },
  { key: "amount", label: "Amount", type: "number", min: 0, portal: false },
  { key: "tags", label: "Tags", type: "multiselect", options: ["a", "b"] },
  { key: "due", label: "Due", type: "date" },
  { key: "ok", label: "OK", type: "checkbox" },
].map((f) => fieldSchema.parse(f));

describe("custom fields", () => {
  it("requires required fields on create", () => {
    const s = buildFieldValuesSchema(fields, { mode: "create", audience: "agent" });
    const r = s.safeParse({});
    expect(r.success).toBe(false);
    expect(s.parse({ order: "FL-1", reason: "Faulty", amount: 10, tags: ["a", "a"] })).toEqual({ order: "FL-1", reason: "Faulty", amount: 10, tags: ["a"] });
  });
  it("validates option values and number bounds", () => {
    const s = buildFieldValuesSchema(fields, { mode: "create", audience: "agent" });
    expect(s.safeParse({ order: "x", reason: "Nope" }).success).toBe(false);
    expect(s.safeParse({ order: "x", reason: "Faulty", amount: -1 }).success).toBe(false);
    expect(s.safeParse({ order: "x", reason: "Faulty", due: "tomorrow" }).success).toBe(false);
  });
  it("hides agent-only fields from the portal", () => {
    const s = buildFieldValuesSchema(fields, { mode: "create", audience: "portal" });
    expect(s.safeParse({ order: "x", reason: "Faulty", amount: 5 }).success).toBe(false);
  });
  it("on update, only validates given keys and blocks clearing required ones", () => {
    const s = buildFieldValuesSchema(fields, { mode: "update", audience: "agent" });
    expect(s.parse({ amount: 3 })).toEqual({ amount: 3 });
    expect(s.parse({ amount: "" })).toEqual({ amount: null });
    expect(s.safeParse({ order: "" }).success).toBe(false);
  });
  it("round-trips storage", () => {
    for (const [f, v] of [
      [fields[3]!, ["a", "b"]],
      [fields[4]!, "2026-05-01"],
      [fields[2]!, 12.5],
      [fields[5]!, true],
      [fields[0]!, "FL-1"],
    ] as const) {
      expect(fromStorage(f, toStorage(f, v))).toEqual(v);
    }
  });
  it("displays labels", () => {
    expect(displayValue(fields[1]!, "Faulty")).toBe("Faulty");
    expect(displayValue(fields[5]!, false)).toBe("No");
  });
});

describe("assignment", () => {
  const c = (userId: string, openCount = 0, available = true, active = true): Candidate => ({ userId, openCount, available, active });
  it("round robin continues after the last pick and wraps", () => {
    const list = [c("a"), c("b"), c("c")];
    expect(pickAssignee("ROUND_ROBIN", list, null)).toBe("a");
    expect(pickAssignee("ROUND_ROBIN", list, "a")).toBe("b");
    expect(pickAssignee("ROUND_ROBIN", list, "c")).toBe("a");
  });
  it("skips unavailable and inactive members", () => {
    expect(pickAssignee("ROUND_ROBIN", [c("a"), c("b", 0, false), c("c", 0, true, false), c("d")], "a")).toBe("d");
    expect(pickAssignee("ROUND_ROBIN", [c("a", 0, false)], null)).toBeNull();
  });
  it("load balancing picks the least loaded, ties round-robin", () => {
    expect(pickAssignee("LOAD_BALANCED", [c("a", 5), c("b", 2), c("c", 9)], null)).toBe("b");
    expect(pickAssignee("LOAD_BALANCED", [c("a", 1), c("b", 1)], "a")).toBe("b");
  });
  it("manual never assigns", () => {
    expect(pickAssignee("MANUAL", [c("a")], null)).toBeNull();
  });
});

describe("ticket access", () => {
  const actor = (role: string, over: Partial<UserActor> = {}): UserActor => ({
    kind: "user",
    id: "me",
    email: "me@x",
    name: "Me",
    roles: [role],
    permissions: expandPermissions(BUILT_IN_ROLES.find((r) => r.key === role)!.permissions),
    organizationId: "org1",
    orgTicketAccess: false,
    teamIds: ["t1"],
    ...over,
  });
  const t = { requesterId: "someone", organizationId: "org1", teamId: "t2", assigneeId: null };
  it("requester sees only their own unless org access", () => {
    expect(canViewTicket(actor("requester"), t)).toBe(false);
    expect(canViewTicket(actor("requester"), { ...t, requesterId: "me" })).toBe(true);
    expect(canViewTicket(actor("requester", { orgTicketAccess: true }), t)).toBe(true);
    expect(canViewTicket(actor("requester", { orgTicketAccess: true, organizationId: "org2" }), t)).toBe(false);
    expect(canViewTicket(actor("requester"), { ...t, watcherUserIds: ["me"] })).toBe(true);
  });
  it("agents see their teams, untriaged and assigned tickets", () => {
    expect(canViewTicket(actor("agent"), t)).toBe(false);
    expect(canViewTicket(actor("agent"), { ...t, teamId: "t1" })).toBe(true);
    expect(canViewTicket(actor("agent"), { ...t, teamId: null })).toBe(true);
    expect(canViewTicket(actor("agent"), { ...t, assigneeId: "me" })).toBe(true);
  });
  it("leads and auditors see everything", () => {
    expect(canViewTicket(actor("team_lead"), t)).toBe(true);
    expect(canViewTicket(actor("auditor"), t)).toBe(true);
  });
  it("internal notes are hidden from requesters", () => {
    expect(canSeeInternal(actor("requester"))).toBe(false);
    expect(canSeeInternal(actor("agent"))).toBe(true);
  });
});

describe("mentions", () => {
  it("extracts unique user ids", () => {
    const html = '<p>Hi <span data-type="mention" data-id="u1" data-label="Ann">@Ann</span> and <span class="mention" data-type="mention" data-id="u2">@Bo</span> <span data-type="mention" data-id="u1">@Ann</span></p>';
    expect(extractMentionIds(html)).toEqual(["u1", "u2"]);
  });
});
