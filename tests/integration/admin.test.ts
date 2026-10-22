import { beforeAll, describe, expect, it, vi } from "vitest";

// Route handlers import the session helper, which imports Auth.js; tests authenticate with API keys instead.
vi.mock("@/server/session", () => ({ getCurrentActor: async () => null }));

import { db } from "@/server/db";
import { syncConfigToDatabase } from "@/server/config-sync";
import { createUser, updateRole, updateUser } from "@/server/services/admin";
import { ForbiddenError } from "@/core/rbac/actor";
import { GET as listUsersRoute, POST as createUserRoute } from "@/app/api/v1/users/route";
import { PATCH as patchUserRoute } from "@/app/api/v1/users/[id]/route";
import { GET as auditRoute } from "@/app/api/v1/audit-logs/route";
import { actorFor, apiKeyFor, makeUser, params, req, setupBusiness } from "./helpers";

let cfg: Awaited<ReturnType<typeof setupBusiness>>;
let adminId: string, agentId: string, requesterId: string, leadId: string;

beforeAll(async () => {
  cfg = await setupBusiness();
  adminId = (await makeUser("admin@test.example", ["admin"])).id;
  leadId = (await makeUser("lead@test.example", ["team_lead"])).id;
  agentId = (await makeUser("agent@test.example", ["agent"])).id;
  requesterId = (await makeUser("req@acmedental.example", ["requester"])).id;
});

describe("config sync", () => {
  it("creates types, SLAs, categories, teams, orgs and roles", async () => {
    expect(await db.ticketType.count()).toBe(4);
    expect(await db.sLAPolicy.count()).toBe(4);
    expect(await db.role.count()).toBe(5);
    expect(await db.organization.count()).toBe(4);
    const battery = await db.category.findUnique({ where: { path: "end_user/laptop/battery" }, include: { parent: true } });
    expect(battery?.parent?.path).toBe("end_user/laptop");
  });

  it("is idempotent and deactivates removed config entries", async () => {
    const modified = structuredClone(cfg);
    modified.sla.policies = modified.sla.policies.filter((p) => p.key !== "p4_low");
    const report = await syncConfigToDatabase(db, modified);
    expect(report.deactivated).toContain("sla policy p4_low");
    expect((await db.sLAPolicy.findUnique({ where: { key: "p4_low" } }))?.isActive).toBe(false);
    await syncConfigToDatabase(db, cfg);
    expect((await db.sLAPolicy.findUnique({ where: { key: "p4_low" } }))?.isActive).toBe(true);
    expect(await db.ticketType.count()).toBe(4);
  });

  it("does not overwrite role permissions edited in the UI", async () => {
    const admin = await actorFor(adminId);
    const agentRole = await db.role.findUniqueOrThrow({ where: { key: "agent" } });
    await updateRole(admin, agentRole.id, { permissions: [...agentRole.permissions, "report.view"] });
    await syncConfigToDatabase(db, cfg);
    expect((await db.role.findUniqueOrThrow({ where: { key: "agent" } })).permissions).toContain("report.view");
    await updateRole(admin, agentRole.id, { permissions: agentRole.permissions });
  });
});

describe("users API: permissions enforced server-side", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await listUsersRoute(req("/api/v1/users"), params());
    expect(res.status).toBe(401);
  });

  it("rejects an invalid API key", async () => {
    const res = await listUsersRoute(req("/api/v1/users", { key: "dfk_nope_nope" }), params());
    expect(res.status).toBe(401);
  });

  it("lets a requester's key do nothing admin-ish", async () => {
    const key = await apiKeyFor(requesterId);
    expect((await listUsersRoute(req("/api/v1/users", { key }), params())).status).toBe(403);
    const res = await createUserRoute(req("/api/v1/users", { key, body: { email: "x@y.example", name: "X", roleKeys: ["requester"] } }), params());
    expect(res.status).toBe(403);
  });

  it("validates input with Zod", async () => {
    const key = await apiKeyFor(adminId);
    const res = await createUserRoute(req("/api/v1/users", { key, body: { email: "not-an-email", name: "", roleKeys: [] } }), params());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.issues.fieldErrors.email).toBeTruthy();
  });

  it("creates a user, links the organization by domain and writes an audit entry", async () => {
    const key = await apiKeyFor(adminId);
    const res = await createUserRoute(req("/api/v1/users", { key, body: { email: "New.Person@BrightsideLaw.example", name: "New Person", roleKeys: ["requester"] } }), params());
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const user = await db.user.findUniqueOrThrow({ where: { id }, include: { organization: true } });
    expect(user.email).toBe("new.person@brightsidelaw.example");
    expect(user.organization?.slug).toBe("brightside-law");
    const auditRes = await auditRoute(req(`/api/v1/audit-logs?entityId=${id}`, { key }), params());
    const audit = await auditRes.json();
    expect(audit.items[0].action).toBe("user.create");
    expect(audit.items[0].actorType).toBe("API_KEY");
  });

  it("enforces the password policy", async () => {
    const admin = await actorFor(adminId);
    await expect(createUser(admin, { email: "weak@test.example", name: "Weak", password: "short", roleKeys: ["requester"] })).rejects.toThrow(/Password must be at least 14/);
  });

  it("rejects duplicate emails with 409", async () => {
    const key = await apiKeyFor(adminId);
    const res = await createUserRoute(req("/api/v1/users", { key, body: { email: "agent@test.example", name: "Dup", roleKeys: ["requester"] } }), params());
    expect(res.status).toBe(409);
  });
});

describe("privilege escalation guards", () => {
  it("a user manager without admin cannot grant the admin role", async () => {
    const managerRole = await db.role.create({ data: { key: "user_manager", name: "User manager", permissions: ["user.view", "user.manage", "ticket.view_own", "ticket.create", "ticket.reply", "catalog.request"] } });
    const mgr = await makeUser("mgr@test.example", ["user_manager"]);
    const actor = await actorFor(mgr.id);
    await expect(createUser(actor, { email: "evil@test.example", name: "Evil", roleKeys: ["admin"] })).rejects.toBeInstanceOf(ForbiddenError);
    // …and cannot edit an admin either
    await expect(updateUser(actor, adminId, { name: "Pwned" })).rejects.toBeInstanceOf(ForbiddenError);
    // but can create requesters
    await expect(createUser(actor, { email: "ok@test.example", name: "Ok", roleKeys: ["requester"] })).resolves.toHaveProperty("id");
    expect(managerRole.isSystem).toBe(false);
  });

  it("protects the last admin", async () => {
    const admin = await actorFor(adminId);
    await expect(updateUser(admin, adminId, { isActive: false })).rejects.toThrow(/cannot deactivate your own account/);
    const other = await makeUser("admin2@test.example", ["admin"]);
    const otherActor = await actorFor(other.id);
    // Remove admin from the first admin: allowed while another admin exists
    await updateUser(otherActor, adminId, { roleKeys: ["agent"] });
    // Now the second admin is last: removing their own admin role must fail
    await expect(updateUser(otherActor, other.id, { roleKeys: ["agent"] })).rejects.toThrow(/last admin/);
    await updateUser(otherActor, adminId, { roleKeys: ["admin"] });
  });

  it("deactivating a user bumps their session version so existing sessions end", async () => {
    const admin = await actorFor(adminId);
    const before = await db.user.findUniqueOrThrow({ where: { id: agentId } });
    await updateUser(admin, agentId, { isActive: false });
    const after = await db.user.findUniqueOrThrow({ where: { id: agentId } });
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    await updateUser(admin, agentId, { isActive: true });
  });

  it("API keys are capped by their owner's current permissions", async () => {
    const key = await apiKeyFor(leadId); // key scopes "*" but lead lacks user.manage
    const res = await createUserRoute(req("/api/v1/users", { key, body: { email: "z@test.example", name: "Z", roleKeys: ["requester"] } }), params());
    expect(res.status).toBe(403);
    const ok = await listUsersRoute(req("/api/v1/users", { key }), params());
    expect(ok.status).toBe(200);
  });

  it("PATCH through the route returns 404 for unknown users", async () => {
    const key = await apiKeyFor(adminId);
    const res = await patchUserRoute(req("/api/v1/users/nope", { method: "PATCH", key, body: { name: "x" } }), params({ id: "nope" }));
    expect(res.status).toBe(404);
  });
});

describe("CSRF", () => {
  it("rejects cookie-authenticated cross-origin mutations", async () => {
    // Session mocked as signed-in admin for this request.
    const session = await import("@/server/session");
    const spy = vi.spyOn(session, "getCurrentActor").mockResolvedValue(await actorFor(adminId));
    const res = await createUserRoute(
      req("/api/v1/users", { body: { email: "csrf@test.example", name: "C", roleKeys: ["requester"] }, headers: { origin: "https://evil.example" } }),
      params(),
    );
    expect(res.status).toBe(403);
    const same = await createUserRoute(
      req("/api/v1/users", { body: { email: "csrf@test.example", name: "C", roleKeys: ["requester"] }, headers: { origin: "http://localhost:3000" } }),
      params(),
    );
    expect(same.status).toBe(201);
    spy.mockRestore();
  });
});
