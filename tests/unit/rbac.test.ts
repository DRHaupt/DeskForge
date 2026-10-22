import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "@/core/rbac/permissions";
import { BUILT_IN_ROLES, expandPermissions } from "@/core/rbac/roles";
import { assertCan, can, ForbiddenError, SYSTEM_ACTOR, type UserActor } from "@/core/rbac/actor";

const user = (perms: string[]): UserActor => ({
  kind: "user",
  id: "u1",
  email: "a@b.c",
  name: "A",
  roles: [],
  permissions: expandPermissions(perms),
  organizationId: null,
  orgTicketAccess: false,
  teamIds: [],
});

describe("rbac", () => {
  it("admin wildcard expands to every permission", () => {
    expect(expandPermissions(["*"]).size).toBe(ALL_PERMISSIONS.length);
  });
  it("ignores unknown permission names", () => {
    expect([...expandPermissions(["ticket.create", "made.up"])]).toEqual(["ticket.create"]);
  });
  it("built-in roles only reference known permissions", () => {
    for (const role of BUILT_IN_ROLES) {
      for (const p of role.permissions) expect(p === "*" || (ALL_PERMISSIONS as string[]).includes(p)).toBe(true);
    }
  });
  it("team lead is a superset of agent", () => {
    const agent = BUILT_IN_ROLES.find((r) => r.key === "agent")!.permissions;
    const lead = new Set(BUILT_IN_ROLES.find((r) => r.key === "team_lead")!.permissions);
    for (const p of agent) expect(lead.has(p)).toBe(true);
  });
  it("requesters cannot write internal notes or reassign", () => {
    const r = user(BUILT_IN_ROLES.find((r) => r.key === "requester")!.permissions);
    expect(can(r, "ticket.comment_internal")).toBe(false);
    expect(can(r, "ticket.reassign")).toBe(false);
    expect(() => assertCan(r, "config.edit")).toThrow(ForbiddenError);
  });
  it("auditor is read-only", () => {
    const a = BUILT_IN_ROLES.find((r) => r.key === "auditor")!.permissions as string[];
    expect(a.some((p) => /manage|edit|create|update|reply|delete|publish|author|assign|transition/.test(p))).toBe(false);
  });
  it("system actor can do anything", () => {
    expect(can(SYSTEM_ACTOR, "config.edit")).toBe(true);
  });
});
