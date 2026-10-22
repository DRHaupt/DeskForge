import { describe, expect, it } from "vitest";
import { automationInputSchema, evaluateConditions, renderTemplate, scheduleMinutes, type Facts } from "@/core/automation/rules";

const facts: Facts = {
  type: "incident",
  priority: "p3",
  status: "open",
  tags: ["vip", "network"],
  title: "VPN DOWN for whole office",
  "requester.domain": "acmedental.example",
  "field.environment": "Office",
  hoursSinceUpdated: 80,
  assignee: null,
  changed: { priority: { from: "p3", to: "p1" } },
};

const run = (all: object[] = [], any: object[] = []) => evaluateConditions(automationInputSchema.shape.conditions.parse({ all, any }), facts);

describe("conditions", () => {
  it("eq / neq are case-insensitive and work on arrays", () => {
    expect(run([{ field: "type", op: "eq", value: "INCIDENT" }])).toBe(true);
    expect(run([{ field: "tags", op: "eq", value: "vip" }])).toBe(true);
    expect(run([{ field: "tags", op: "neq", value: "vip" }])).toBe(false);
  });
  it("in / not_in / contains / starts_with", () => {
    expect(run([{ field: "priority", op: "in", value: ["p1", "p3"] }])).toBe(true);
    expect(run([{ field: "tags", op: "not_in", value: ["spam"] }])).toBe(true);
    expect(run([{ field: "title", op: "contains", value: "vpn down" }])).toBe(true);
    expect(run([{ field: "requester.domain", op: "starts_with", value: "acme" }])).toBe(true);
  });
  it("numbers, set/unset and custom fields", () => {
    expect(run([{ field: "hoursSinceUpdated", op: "gte", value: 72 }])).toBe(true);
    expect(run([{ field: "assignee", op: "is_not_set" }])).toBe(true);
    expect(run([{ field: "field.environment", op: "eq", value: "office" }])).toBe(true);
  });
  it("change operators", () => {
    expect(run([{ field: "priority", op: "changed" }])).toBe(true);
    expect(run([{ field: "priority", op: "changed_to", value: "p1" }])).toBe(true);
    expect(run([{ field: "priority", op: "changed_from", value: "p1" }])).toBe(false);
    expect(run([{ field: "status", op: "changed" }])).toBe(false);
  });
  it("all + any semantics", () => {
    expect(run([{ field: "type", op: "eq", value: "incident" }], [{ field: "priority", op: "eq", value: "p1" }, { field: "tags", op: "contains", value: "vip" }])).toBe(true);
    expect(run([{ field: "type", op: "eq", value: "incident" }], [{ field: "priority", op: "eq", value: "p1" }])).toBe(false);
    expect(run()).toBe(true);
  });
  it("rejects unknown fields", () => {
    expect(() => automationInputSchema.shape.conditions.parse({ all: [{ field: "password", op: "eq", value: "x" }] })).toThrow();
  });
});

describe("templates", () => {
  it("replaces and escapes", () => {
    expect(renderTemplate("Hi {{requester.name}}, re {{ticket.number}}{{missing}}", { "requester.name": "<Ann>", "ticket.number": "INC1" }, { html: true })).toBe("Hi &lt;Ann&gt;, re INC1");
    expect(renderTemplate("{{ tags }}", { tags: ["a", "b"] })).toBe("a, b");
  });
});

describe("schedule", () => {
  it("clamps intervals", () => {
    expect(scheduleMinutes("every 15m")).toBe(15);
    expect(scheduleMinutes("every 1m")).toBe(5);
    expect(scheduleMinutes(null)).toBe(60);
  });
});
