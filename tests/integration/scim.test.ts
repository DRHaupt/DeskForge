import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/server/session", () => ({ getCurrentActor: async () => null }));

import { parseBusinessConfig, setConfig } from "@/core/config/loader";
import { db } from "@/server/db";
import { syncConfigToDatabase } from "@/server/config-sync";
import { MemoryTransport, setMailTransport } from "@/server/mail/transport";
import { rotateScimToken } from "@/server/scim";
import { GET as listUsers, POST as createUser } from "@/app/scim/v2/Users/route";
import { DELETE as deleteUser, GET as getUser, PATCH as patchUser, PUT as putUser } from "@/app/scim/v2/Users/[id]/route";
import { GET as groups } from "@/app/scim/v2/Groups/route";
import { GET as spc } from "@/app/scim/v2/ServiceProviderConfig/route";
import { DELETE as revokeToken, POST as newToken } from "@/app/api/v1/provisioning/token/route";
import { apiKeyFor, makeUser, params, req, resetDb } from "./helpers";

const mail = new MemoryTransport();
let token: string;
const base = parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../examples/internal-it.yaml"), "utf8"));

function configure(scim: object, onboarding: object = { enabled: false }) {
  const raw = structuredClone(base);
  raw.scim = scim;
  raw.onboarding = { ...raw.onboarding, ...onboarding };
  const cfg = parseBusinessConfig(raw);
  setConfig(cfg);
  return cfg;
}

const scimReq = (url: string, init: { method?: string; body?: unknown; auth?: string | null } = {}) =>
  req(`/scim/v2${url}`, {
    method: init.method,
    body: init.body,
    headers: init.auth === null ? {} : { authorization: `Bearer ${init.auth ?? token}` },
  });
const json = async (r: Response) => (await r.json()) as Record<string, any>;

const entraUser = (over: Record<string, unknown> = {}) => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User", "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"],
  externalId: "aad-1",
  userName: "jamie.new@drhaupt.example",
  active: true,
  displayName: "Jamie New",
  emails: [{ primary: true, type: "work", value: "jamie.new@drhaupt.example" }],
  name: { givenName: "Jamie", familyName: "New" },
  title: "Coordinator",
  ...over,
});

beforeAll(async () => {
  const cfg = configure({ enabled: true });
  await resetDb();
  await syncConfigToDatabase(db, cfg);
  setMailTransport(mail);
});

beforeEach(async () => {
  configure({ enabled: true });
  token = await rotateScimToken(null);
  await db.user.deleteMany({ where: { email: { contains: "@drhaupt.example" } } });
});

describe("auth", () => {
  it("rejects missing or wrong tokens, and 404s when disabled", async () => {
    expect((await listUsers(scimReq("/Users", { auth: null }), params())).status).toBe(401);
    const bad = await listUsers(scimReq("/Users", { auth: "dfscim_nope" }), params());
    expect(bad.status).toBe(401);
    expect(bad.headers.get("content-type")).toBe("application/scim+json");
    expect((await json(bad)).schemas).toEqual(["urn:ietf:params:scim:api:messages:2.0:Error"]);
    configure({ enabled: false });
    expect((await listUsers(scimReq("/Users"), params())).status).toBe(404);
  });

  it("an old token stops working when a new one is generated", async () => {
    const old = token;
    token = await rotateScimToken(null);
    expect((await listUsers(scimReq("/Users", { auth: old }), params())).status).toBe(401);
    expect((await listUsers(scimReq("/Users"), params())).status).toBe(200);
  });
});

describe("Entra Test Connection and discovery", () => {
  it("returns an empty list for a random userName", async () => {
    const r = await listUsers(scimReq(`/Users?filter=${encodeURIComponent('userName eq "8b0b9b6e-1e2f-4f0f-9c1e-7f3d2a9b0c11"')}`), params());
    expect(r.status).toBe(200);
    expect(await json(r)).toMatchObject({ totalResults: 0, Resources: [] });
  });
  it("serves ServiceProviderConfig and an empty Groups list", async () => {
    expect((await json(await spc(scimReq("/ServiceProviderConfig"), params()))).patch).toEqual({ supported: true });
    expect((await json(await groups(scimReq("/Groups"), params()))).totalResults).toBe(0);
  });
  it("rejects unsupported filters with invalidFilter", async () => {
    const r = await listUsers(scimReq(`/Users?filter=${encodeURIComponent('title co "x"')}`), params());
    expect(r.status).toBe(400);
    expect((await json(r)).scimType).toBe("invalidFilter");
  });
});

describe("user lifecycle", () => {
  it("creates, finds, updates, deactivates and reactivates", async () => {
    const created = await createUser(scimReq("/Users", { body: entraUser() }), params());
    expect(created.status).toBe(201);
    const u = await json(created);
    expect(u).toMatchObject({ userName: "jamie.new@drhaupt.example", externalId: "aad-1", displayName: "Jamie New", active: true, title: "Coordinator" });

    const row = await db.user.findUniqueOrThrow({ where: { id: u.id }, include: { roles: { include: { role: true } } } });
    expect(row.provisionedVia).toBe("scim");
    expect(row.roles.map((r) => r.role.key)).toEqual(["requester"]);
    expect(row.passwordHash).toBeNull();

    // Case-insensitive userName lookup, and externalId lookup.
    const found = await json(await listUsers(scimReq(`/Users?filter=${encodeURIComponent('userName eq "Jamie.New@drhaupt.example"')}`), params()));
    expect(found.totalResults).toBe(1);
    expect(found.Resources[0].id).toBe(u.id);
    expect((await json(await listUsers(scimReq(`/Users?filter=${encodeURIComponent('externalId eq "aad-1"')}`), params()))).totalResults).toBe(1);

    // Duplicate create → 409 uniqueness.
    const dup = await createUser(scimReq("/Users", { body: entraUser() }), params());
    expect(dup.status).toBe(409);
    expect((await json(dup)).scimType).toBe("uniqueness");

    // PATCH with paths (Entra style, string boolean).
    const p1 = await patchUser(
      scimReq(`/Users/${u.id}`, { method: "PATCH", body: { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "Replace", path: "displayName", value: "Jamie Renamed" }, { op: "Add", path: 'emails[type eq "work"].value', value: "jamie.r@drhaupt.example" }] } }),
      params({ id: u.id }),
    );
    expect(p1.status).toBe(200);
    expect(await json(p1)).toMatchObject({ displayName: "Jamie Renamed", emails: [{ value: "jamie.r@drhaupt.example" }] });

    // Deactivate: signs the person out.
    const before = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    const off = await patchUser(scimReq(`/Users/${u.id}`, { method: "PATCH", body: { Operations: [{ op: "Replace", path: "active", value: "False" }] } }), params({ id: u.id }));
    expect((await json(off)).active).toBe(false);
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.isActive).toBe(false);
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);

    // Reactivate via a no-path value object.
    const on = await patchUser(scimReq(`/Users/${u.id}`, { method: "PATCH", body: { Operations: [{ op: "replace", value: { active: true } }] } }), params({ id: u.id }));
    expect((await json(on)).active).toBe(true);

    // PUT replaces attributes.
    const put = await putUser(scimReq(`/Users/${u.id}`, { method: "PUT", body: entraUser({ displayName: "Jamie Put", title: "Lead" }) }), params({ id: u.id }));
    expect(await json(put)).toMatchObject({ displayName: "Jamie Put", title: "Lead", emails: [{ value: "jamie.new@drhaupt.example" }] });

    // DELETE deactivates but keeps the record.
    expect((await deleteUser(scimReq(`/Users/${u.id}`, { method: "DELETE" }), params({ id: u.id }))).status).toBe(204);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).isActive).toBe(false);
    expect((await json(await getUser(scimReq(`/Users/${u.id}`), params({ id: u.id })))).active).toBe(false);

    const actions = (await db.auditLog.findMany({ where: { entityId: u.id, action: { startsWith: "scim." } }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["scim.user_created", "scim.user_updated", "scim.user_deactivated", "scim.user_reactivated", "scim.user_updated", "scim.user_deactivated"]);
  });

  it("404s unknown users", async () => {
    const r = await getUser(scimReq("/Users/nope"), params({ id: "nope" }));
    expect(r.status).toBe(404);
  });

  it("adopts an existing account with the same email and keeps its roles", async () => {
    const existing = await makeUser("tech.person@drhaupt.example", ["agent"], { name: "Tech Person" });
    const r = await createUser(scimReq("/Users", { body: entraUser({ externalId: "aad-2", userName: "tech.person@drhaupt.example", emails: [{ type: "work", value: "TECH.person@drhaupt.example" }] }) }), params());
    expect(r.status).toBe(201);
    expect((await json(r)).id).toBe(existing.id);
    const row = await db.user.findUniqueOrThrow({ where: { id: existing.id }, include: { roles: { include: { role: true } } } });
    expect(row).toMatchObject({ provisionedVia: "scim", scimExternalId: "aad-2" });
    expect(row.roles.map((x) => x.role.key)).toEqual(["agent"]);
    // Role changes never come from provisioning.
    await patchUser(scimReq(`/Users/${existing.id}`, { method: "PATCH", body: { Operations: [{ op: "add", path: "roles", value: [{ value: "admin" }] }] } }), params({ id: existing.id }));
    expect((await db.userRole.count({ where: { userId: existing.id } }))).toBe(1);
  });

  it("refuses an email change that collides with another account", async () => {
    await makeUser("taken@drhaupt.example", ["requester"]);
    const u = await json(await createUser(scimReq("/Users", { body: entraUser() }), params()));
    const r = await patchUser(scimReq(`/Users/${u.id}`, { method: "PATCH", body: { Operations: [{ op: "replace", path: 'emails[type eq "work"].value', value: "taken@drhaupt.example" }] } }), params({ id: u.id }));
    expect(r.status).toBe(409);
  });

  it("uses userName as the email when no emails are sent, and requires one", async () => {
    const r = await createUser(scimReq("/Users", { body: { userName: "upn.only@drhaupt.example", externalId: "aad-3" } }), params());
    expect((await json(r)).emails[0].value).toBe("upn.only@drhaupt.example");
    const bad = await createUser(scimReq("/Users", { body: { userName: "no-email-here", externalId: "aad-4" } }), params());
    expect(bad.status).toBe(400);
  });

  it("never deactivates the last admin", async () => {
    await db.user.updateMany({ where: { roles: { some: { role: { key: "admin" } } } }, data: { isActive: false } });
    const admin = await makeUser("only.admin@drhaupt.example", ["admin"]);
    await patchUser(scimReq(`/Users/${admin.id}`, { method: "PATCH", body: { Operations: [{ op: "replace", path: "active", value: "False" }] } }), params({ id: admin.id }));
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).isActive).toBe(true);
  });

  it("sends the welcome email to new people when configured", async () => {
    configure({ enabled: true, sendWelcomeEmail: true }, { enabled: true });
    mail.sent.length = 0;
    await createUser(scimReq("/Users", { body: entraUser({ externalId: "aad-5" }) }), params());
    expect(mail.sent.map((m) => m.to)).toEqual(["jamie.new@drhaupt.example"]);
  });

  it("pages results", async () => {
    for (let i = 0; i < 3; i++) await createUser(scimReq("/Users", { body: entraUser({ externalId: `p-${i}`, userName: `p${i}@drhaupt.example`, emails: [] }) }), params());
    const page = await json(await listUsers(scimReq("/Users?startIndex=2&count=1"), params()));
    expect(page.startIndex).toBe(2);
    expect(page.itemsPerPage).toBe(1);
    expect(page.totalResults).toBeGreaterThanOrEqual(3);
  });
});

describe("token admin API", () => {
  it("needs user.manage and returns the token once", async () => {
    const admin = await makeUser("boss@drhaupt.example", ["admin"]);
    const agent = await makeUser("agent@drhaupt.example", ["agent"]);
    expect((await newToken(req("/api/v1/provisioning/token", { method: "POST", key: await apiKeyFor(agent.id) }), params())).status).toBe(403);
    const r = await newToken(req("/api/v1/provisioning/token", { method: "POST", key: await apiKeyFor(admin.id) }), params());
    expect(r.status).toBe(201);
    const { token: fresh } = (await r.json()) as { token: string };
    expect(fresh).toMatch(/^dfscim_/);
    expect((await listUsers(scimReq("/Users", { auth: fresh }), params())).status).toBe(200);
    expect((await revokeToken(req("/api/v1/provisioning/token", { method: "DELETE", key: await apiKeyFor(admin.id) }), params())).status).toBe(200);
    expect((await listUsers(scimReq("/Users", { auth: fresh }), params())).status).toBe(401);
  });
});

describe("config", () => {
  it("refuses admin as the default role and welcome email without onboarding", () => {
    const raw = structuredClone(base);
    raw.scim = { enabled: true, defaultRole: "admin" };
    expect(() => parseBusinessConfig(raw)).toThrow(/can't create admins/);
    raw.scim = { enabled: true, sendWelcomeEmail: true };
    raw.onboarding = { enabled: false };
    expect(() => parseBusinessConfig(raw)).toThrow(/onboarding/);
  });
});
