import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/server/session", () => ({ getCurrentActor: async () => null }));

import http from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "@/server/db";
import { syncConfigToDatabase } from "@/server/config-sync";
import { onTicketEvent, type TicketEvent } from "@/server/events";
import { MemoryTransport, setMailTransport } from "@/server/mail/transport";
import { createAutomation, runAutomationsForEvent, runScheduledAutomations, testAutomation } from "@/server/automation";
import { createWebhook, fanOutWebhooks, verifySignature, assertSafeUrl } from "@/server/webhooks";
import { createApiKey, revokeApiKey } from "@/server/services/api-key-admin";
import { applyMacro, createCanned } from "@/server/services/canned";
import { createTicket, getTicket, transitionTicket } from "@/server/services/tickets";
import { buildOpenApi } from "@/server/openapi";
import { GET as listTicketsRoute } from "@/app/api/v1/tickets/route";
import type { UserActor } from "@/core/rbac/actor";
import { actorFor, makeUser, params, req, setupBusiness } from "./helpers";

const mail = new MemoryTransport();
let admin: UserActor, agent: UserActor, requester: UserActor, vipRequester: UserActor;
const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
let server: http.Server;
let url = "";
let failNext = 0;

beforeAll(async () => {
  process.env.WEBHOOK_ALLOW_PRIVATE = "true";
  server = http.createServer((rq, rs) => {
    let body = "";
    rq.on("data", (c) => (body += c));
    rq.on("end", () => {
      if (failNext > 0) {
        failNext--;
        rs.writeHead(500).end("nope");
        return;
      }
      received.push({ headers: rq.headers, body });
      rs.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;

  const cfg = await setupBusiness("msp-it-support");
  setMailTransport(mail);
  const sd = await db.team.findUniqueOrThrow({ where: { key: "service_desk" } });
  const ad = await makeUser("admin@northbeam-it.example", ["admin"], { name: "Admin" });
  const a = await makeUser("mia.chen@northbeam-it.example", ["agent"], { name: "Mia Chen" });
  await db.teamMember.create({ data: { teamId: sd.id, userId: a.id } });
  const acme = await db.organization.findUniqueOrThrow({ where: { slug: "acme-dental" } });
  const law = await db.organization.findUniqueOrThrow({ where: { slug: "brightside-law" } });
  const r = await makeUser("rita@acmedental.example", ["requester"], { organizationId: acme.id, name: "Rita" });
  const v = await makeUser("vip@brightsidelaw.example", ["requester"], { organizationId: law.id, name: "Victor VIP" });
  await syncConfigToDatabase(db, cfg);
  [admin, agent, requester, vipRequester] = await Promise.all([ad, a, r, v].map((u) => actorFor(u.id)));
  // Simulate the worker for automations.
  onTicketEvent(async (e) => {
    await runAutomationsForEvent(e);
  });
});

afterAll(() => server.close());

describe("automations", () => {
  it("raises priority and tags tickets from a VIP organization on creation", async () => {
    await createAutomation(admin, {
      name: "VIP clients get P2",
      trigger: "ticket.created",
      conditions: { all: [{ field: "organization", op: "eq", value: "brightside-law" }], any: [] },
      actions: [
        { type: "set_priority", value: "p2" },
        { type: "add_tag", value: "vip" },
        { type: "add_comment", body: "VIP client {{requester.name}} — handle with care.", visibility: "INTERNAL" },
      ],
    });
    const t = await createTicket(vipRequester, { type: "incident", title: "Outlook is slow" });
    const full = await getTicket(admin, t.id);
    expect(full.priority).toBe("p2");
    expect(full.tags.map((x) => x.tag.name)).toContain("vip");
    const note = await db.comment.findFirst({ where: { ticketId: t.id, visibility: "INTERNAL" } });
    expect(note?.bodyText).toBe("VIP client Victor VIP — handle with care.");
    const other = await createTicket(requester, { type: "incident", title: "Not VIP" });
    expect((await getTicket(admin, other.id)).priority).toBe("p3");
  });

  it("routes by keyword and records runs", async () => {
    const a = await createAutomation(admin, {
      name: "Phishing to security",
      trigger: "ticket.created",
      conditions: { all: [], any: [{ field: "title", op: "contains", value: "phish" }, { field: "description", op: "contains", value: "suspicious link" }] },
      actions: [{ type: "assign_team", team: "security" }],
    });
    const t = await createTicket(requester, { type: "incident", title: "Got a weird email", description: "<p>It has a suspicious link</p>" });
    expect((await getTicket(admin, t.id)).team?.key).toBe("security");
    const runs = await db.automationRun.findMany({ where: { automationId: a.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.success).toBe(true);
  });

  it("stops automation loops", async () => {
    // Two rules that keep flipping priority on update; depth limit must stop them.
    await createAutomation(admin, { name: "Flip to p1", trigger: "ticket.updated", conditions: { all: [{ field: "priority", op: "changed_to", value: "p4" }], any: [] }, actions: [{ type: "set_priority", value: "p1" }] });
    await createAutomation(admin, { name: "Flip to p4", trigger: "ticket.updated", conditions: { all: [{ field: "priority", op: "changed_to", value: "p1" }], any: [] }, actions: [{ type: "set_priority", value: "p4" }] });
    const t = await createTicket(requester, { type: "incident", title: "Loop test" });
    const { updateTicket } = await import("@/server/services/tickets");
    await updateTicket(agent, t.id, { priority: "p4" });
    const runs = await db.automationRun.count({ where: { ticketId: t.id } });
    expect(runs).toBeLessThanOrEqual(3);
    await db.automation.updateMany({ where: { name: { startsWith: "Flip" } }, data: { isActive: false } });
  });

  it("runs scheduled rules once per ticket until it changes again", async () => {
    await createAutomation(admin, {
      name: "Close stale resolved tickets",
      trigger: "schedule",
      schedule: "every 15m",
      conditions: { all: [{ field: "status", op: "eq", value: "resolved" }, { field: "hoursSinceUpdated", op: "gte", value: 72 }], any: [] },
      actions: [{ type: "set_status", value: "closed", comment: "Closing after 3 days without a reply." }],
    });
    const t = await createTicket(requester, { type: "incident", title: "Stale" });
    await transitionTicket(agent, t.id, { to: "resolved", comment: "fixed" });
    await db.ticket.update({ where: { id: t.id }, data: { updatedAt: new Date(Date.now() - 80 * 3600_000) } });
    const res = await runScheduledAutomations();
    expect(res.find((r) => r.automation === "Close stale resolved tickets")?.matched).toBeGreaterThanOrEqual(1);
    expect((await getTicket(admin, t.id)).status).toBe("closed");
    // Not due again yet:
    expect((await runScheduledAutomations()).find((r) => r.automation === "Close stale resolved tickets")).toBeUndefined();
  });

  it("can be dry-run against a ticket", async () => {
    const t = await createTicket(vipRequester, { type: "incident", title: "Dry run" });
    const res = await testAutomation(admin, { name: "x", trigger: "ticket.created", conditions: { all: [{ field: "organization", op: "eq", value: "brightside-law" }], any: [] }, actions: [{ type: "add_tag", value: "x" }] }, t.id);
    expect(res.matches).toBe(true);
  });

  it("rejects automations referencing unknown priorities, and requires permission", async () => {
    await expect(createAutomation(admin, { name: "bad", trigger: "ticket.created", conditions: { all: [], any: [] }, actions: [{ type: "set_priority", value: "urgent!!" }] })).rejects.toThrow(/Unknown priority/);
    await expect(createAutomation(agent, { name: "nope", trigger: "ticket.created", conditions: { all: [], any: [] }, actions: [{ type: "add_tag", value: "x" }] })).rejects.toThrow(/Missing permission/);
  });
});

describe("webhooks", () => {
  it("blocks private addresses unless allowed", async () => {
    const { getEnv } = await import("@/server/env");
    const env = getEnv();
    (env as { WEBHOOK_ALLOW_PRIVATE: boolean }).WEBHOOK_ALLOW_PRIVATE = false;
    await expect(assertSafeUrl("http://127.0.0.1/x")).rejects.toThrow(/private/);
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/private/);
    await expect(assertSafeUrl("ftp://example.com")).rejects.toThrow(/http or https/);
    (env as { WEBHOOK_ALLOW_PRIVATE: boolean }).WEBHOOK_ALLOW_PRIVATE = true;
  });

  it("delivers signed payloads and retries failures", async () => {
    const { secret } = await createWebhook(admin, { name: "Test receiver", url, events: ["ticket.created", "ticket.status_changed"], isActive: true });
    const t = await createTicket(requester, { type: "incident", title: "Webhook me" });
    const event: TicketEvent = { type: "ticket.created", ticketId: t.id, actor: { kind: "user", userId: requester.id, label: requester.email }, at: new Date().toISOString() };
    received.length = 0;
    await fanOutWebhooks(event);
    expect(received).toHaveLength(1);
    const r = received[0]!;
    expect(r.headers["x-deskforge-event"]).toBe("ticket.created");
    expect(verifySignature(secret, String(r.headers["x-deskforge-signature"]), r.body)).toBe(true);
    expect(verifySignature("wrong", String(r.headers["x-deskforge-signature"]), r.body)).toBe(false);
    const body = JSON.parse(r.body);
    expect(body.ticket.number).toBe(t.number);
    expect(body.event).toBe("ticket.created");

    failNext = 1;
    await fanOutWebhooks(event);
    const failed = await db.webhookDelivery.findFirstOrThrow({ where: { status: "PENDING" }, orderBy: { createdAt: "desc" } });
    expect(failed.attempts).toBe(1);
    expect(failed.responseStatus).toBe(500);
    const { deliverWebhook } = await import("@/server/webhooks");
    await deliverWebhook(failed.id); // retry succeeds
    expect((await db.webhookDelivery.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe("SUCCEEDED");
  });

  it("ignores events the webhook isn't subscribed to", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Not subscribed" });
    received.length = 0;
    await fanOutWebhooks({ type: "ticket.commented", ticketId: t.id, actor: { kind: "system", userId: null, label: "x" }, at: new Date().toISOString() });
    expect(received).toHaveLength(0);
  });
});

describe("API keys", () => {
  it("are shown once, scoped, capped by their creator, and revocable", async () => {
    const { key, id } = await createApiKey(admin, { name: "Monitoring", permissions: ["ticket.view_all"] });
    const ok = await listTicketsRoute(req("/api/v1/tickets", { key }), params());
    expect(ok.status).toBe(200);
    const { POST: createRoute } = await import("@/app/api/v1/tickets/route");
    const denied = await createRoute(req("/api/v1/tickets", { key, body: { type: "incident", title: "From key" } }), params());
    expect(denied.status).toBe(403);
    await expect(createApiKey(agent, { name: "Escalate", permissions: ["user.manage"] })).rejects.toThrow();
    await revokeApiKey(admin, id);
    expect((await listTicketsRoute(req("/api/v1/tickets", { key }), params())).status).toBe(401);
  });
});

describe("macros", () => {
  it("apply their actions with the agent's permissions", async () => {
    const { id } = await createCanned(admin, { name: "Waiting on you", body: "<p>Hi {{requester.name}}</p>", actions: [{ type: "set_status", value: "in_progress" }, { type: "add_tag", value: "macro" }, { type: "assign_to_me" }], isShared: true });
    const t = await createTicket(requester, { type: "incident", title: "Macro me" });
    await applyMacro(agent, t.id, id);
    const full = await getTicket(admin, t.id);
    expect(full.status).toBe("in_progress");
    expect(full.tags.map((x) => x.tag.name)).toContain("macro");
    expect(full.assigneeId).toBe(agent.id);
    await expect(createCanned(agent, { name: "Shared?", body: "x", isShared: true })).rejects.toThrow(/canned.manage/);
  });
});

describe("OpenAPI", () => {
  it("documents every endpoint with schemas from Zod", () => {
    const spec = buildOpenApi();
    expect(spec.openapi).toBe("3.1.0");
    const post = (spec.paths["/tickets"] as Record<string, { requestBody: { content: Record<string, { schema: { required: string[] } }> } }>).post;
    expect(post.requestBody.content["application/json"]!.schema.required).toEqual(expect.arrayContaining(["type", "title"]));
    expect(Object.keys(spec.paths).length).toBeGreaterThan(40);
  });
});
