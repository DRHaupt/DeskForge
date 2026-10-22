import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseBusinessConfigYaml } from "@/core/config/loader";
import { availableTransitions, resolveTransition, WorkflowError, type WorkflowActor } from "@/core/workflow/engine";

const cfg = parseBusinessConfigYaml(fs.readFileSync(path.resolve(import.meta.dirname, "../../examples/msp-it-support.yaml"), "utf8"));
const incident = cfg.ticketTypes.find((t) => t.key === "incident")!;
const change = cfg.ticketTypes.find((t) => t.key === "change")!;

const agent: WorkflowActor = { kind: "user", roles: ["agent"], canTransition: true, isRequester: false };
const lead: WorkflowActor = { kind: "user", roles: ["team_lead"], canTransition: true, isRequester: false };
const requester: WorkflowActor = { kind: "user", roles: ["requester"], canTransition: false, isRequester: true };
const otherRequester: WorkflowActor = { kind: "user", roles: ["requester"], canTransition: false, isRequester: false };

describe("workflow engine", () => {
  it("lists transitions an agent may perform", () => {
    const to = availableTransitions(incident, "new", agent).map((t) => t.to);
    expect(to).toEqual(["assigned", "in_progress", "resolved"]);
  });

  it("requester can only reopen/close their own resolved ticket", () => {
    expect(availableTransitions(incident, "resolved", requester).map((t) => t.to).sort()).toEqual(["closed", "open"]);
    expect(availableTransitions(incident, "resolved", otherRequester)).toEqual([]);
    expect(availableTransitions(incident, "in_progress", requester)).toEqual([]);
  });

  it("enforces requireComment", () => {
    expect(() => resolveTransition(incident, "in_progress", "resolved", agent)).toThrow(/comment is required/);
    expect(resolveTransition(incident, "in_progress", "resolved", agent, "Fixed the DNS record").to).toBe("resolved");
  });

  it("rejects transitions that do not exist", () => {
    expect(() => resolveTransition(incident, "closed", "in_progress", agent)).toThrow(WorkflowError);
    expect(() => resolveTransition(incident, "new", "nope", agent)).toThrow(/not a status/);
    expect(() => resolveTransition(incident, "new", "new", agent)).toThrow(/already/);
  });

  it("restricts role-specific transitions (CAB approval needs a lead)", () => {
    expect(() => resolveTransition(change, "awaiting_approval", "approved", agent)).toThrow(/not allowed/);
    expect(resolveTransition(change, "awaiting_approval", "approved", lead).to).toBe("approved");
  });

  it("system actor may perform any configured transition", () => {
    expect(resolveTransition(change, "awaiting_approval", "approved", { kind: "system" }).to).toBe("approved");
  });

  it("superusers may perform any configured transition", () => {
    const admin: WorkflowActor = { kind: "user", roles: ["custom"], canTransition: true, isSuperuser: true, isRequester: false };
    expect(resolveTransition(incident, "closed", "open", admin).to).toBe("open");
  });

  it("supports '*' as from", () => {
    const task = parseBusinessConfigYaml(fs.readFileSync(path.resolve(import.meta.dirname, "../../examples/internal-it.yaml"), "utf8")).ticketTypes.find((t) => t.key === "task")!;
    expect(availableTransitions(task, "backlog", agent).map((t) => t.to)).toEqual(["todo", "doing", "review", "done"]);
  });
});
