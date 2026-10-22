import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/server/session", () => ({ getCurrentActor: async () => null }));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "@/server/db";
import { LocalStorage } from "@/server/storage/local";
import { setStorage } from "@/server/storage";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/tickets/route";
import { GET as getRoute } from "@/app/api/v1/tickets/[id]/route";
import { POST as commentRoute } from "@/app/api/v1/tickets/[id]/comments/route";
import { GET as timelineRoute } from "@/app/api/v1/tickets/[id]/timeline/route";
import { POST as transitionRoute } from "@/app/api/v1/tickets/[id]/transition/route";
import { POST as uploadRoute } from "@/app/api/v1/attachments/route";
import { GET as downloadRoute } from "@/app/api/v1/attachments/[id]/route";
import { GET as searchRoute } from "@/app/api/v1/search/route";
import { NextRequest } from "next/server";
import { apiKeyFor, makeUser, params, req, setupBusiness } from "./helpers";

let agentKey: string, requesterKey: string, otherKey: string;

beforeAll(async () => {
  await setupBusiness("ecommerce-support");
  setStorage(new LocalStorage(fs.mkdtempSync(path.join(os.tmpdir(), "df-store-"))));
  const team = await db.team.findUniqueOrThrow({ where: { key: "customer_care" } });
  const agent = await makeUser("olivia@fernleaf-home.example", ["agent"], { name: "Olivia" });
  await db.teamMember.create({ data: { teamId: team.id, userId: agent.id } });
  agentKey = await apiKeyFor(agent.id);
  requesterKey = await apiKeyFor((await makeUser("pat@customer.example", ["requester"], { name: "Pat" })).id);
  otherKey = await apiKeyFor((await makeUser("kim@customer.example", ["requester"], { name: "Kim" })).id);
});

async function upload(key: string, name: string, type: string, content: string | Buffer) {
  const form = new FormData();
  form.append("file", new Blob([typeof content === "string" ? content : new Uint8Array(content)], { type }), name);
  const r = new NextRequest(new URL("/api/v1/attachments", "http://localhost:3000"), { method: "POST", body: form, headers: { authorization: `Bearer ${key}` } });
  return uploadRoute(r, params());
}

describe("ticket API", () => {
  let ticketId: string;

  it("requester creates an order problem with required custom fields", async () => {
    const bad = await createRoute(req("/api/v1/tickets", { key: requesterKey, body: { type: "order_issue", title: "Broken mug" } }), params());
    expect(bad.status).toBe(400);
    const ok = await createRoute(
      req("/api/v1/tickets", { key: requesterKey, body: { type: "order_issue", title: "Broken mug", description: "<p>Arrived broken</p>", fields: { order_number: "FL-104300", issue_kind: "Item damaged" } } }),
      params(),
    );
    expect(ok.status).toBe(201);
    const body = await ok.json();
    expect(body.number).toMatch(/^ORD\d{7}$/);
    ticketId = body.id;
  });

  it("hides the agent-only refund field from requesters", async () => {
    const res = await createRoute(
      req("/api/v1/tickets", { key: requesterKey, body: { type: "return_request", title: "Return", fields: { order_number: "FL-1", reason: "Faulty", items: "1 lamp", refund_amount: 10 } } }),
      params(),
    );
    expect(res.status).toBe(400);
  });

  it("serializes tickets without leaking to other requesters", async () => {
    const mine = await getRoute(req(`/api/v1/tickets/${ticketId}`, { key: requesterKey }), params({ id: ticketId }));
    expect(mine.status).toBe(200);
    const json = await mine.json();
    expect(json.fields.order_number).toBe("FL-104300");
    expect(json.watchers).toBeUndefined();
    expect((await getRoute(req(`/api/v1/tickets/${ticketId}`, { key: otherKey }), params({ id: ticketId }))).status).toBe(404);
    const list = await (await listRoute(req("/api/v1/tickets", { key: otherKey }), params())).json();
    expect(list.items).toHaveLength(0);
  });

  it("uploads attachments with type limits and links them to comments", async () => {
    const exe = await upload(agentKey, "evil.exe", "application/octet-stream", "MZ");
    expect(exe.status).toBe(400);
    const html = await upload(agentKey, "page.html", "text/html", "<script>");
    expect(html.status).toBe(400);
    const png = await upload(agentKey, "photo.png", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(png.status).toBe(201);
    const { id: attId } = await png.json();
    // Unlinked uploads are private to the uploader
    expect((await downloadRoute(req(`/api/v1/attachments/${attId}`, { key: requesterKey }), params({ id: attId }))).status).toBe(404);
    const c = await commentRoute(req(`/api/v1/tickets/${ticketId}/comments`, { key: agentKey, body: { body: "<p>Internal photo</p>", visibility: "INTERNAL", attachmentIds: [attId] } }), params({ id: ticketId }));
    expect(c.status).toBe(201);
    // Attachment on an internal note: agent yes, requester no
    expect((await downloadRoute(req(`/api/v1/attachments/${attId}`, { key: agentKey }), params({ id: attId }))).status).toBe(200);
    expect((await downloadRoute(req(`/api/v1/attachments/${attId}`, { key: requesterKey }), params({ id: attId }))).status).toBe(404);
  });

  it("timeline for requester excludes internal notes", async () => {
    const res = await timelineRoute(req(`/api/v1/tickets/${ticketId}/timeline`, { key: requesterKey }), params({ id: ticketId }));
    const { items } = await res.json();
    expect(items.some((i: { visibility?: string }) => i.visibility === "INTERNAL")).toBe(false);
  });

  it("requester can solve their own ticket (allowed by the store workflow)", async () => {
    const res = await transitionRoute(req(`/api/v1/tickets/${ticketId}/transition`, { key: requesterKey, body: { to: "solved", comment: "Sorted, thanks" } }), params({ id: ticketId }));
    expect(res.status).toBe(200);
    const bad = await transitionRoute(req(`/api/v1/tickets/${ticketId}/transition`, { key: requesterKey, body: { to: "closed" } }), params({ id: ticketId }));
    expect(bad.status).toBe(400);
  });

  it("search respects visibility", async () => {
    const mine = await (await searchRoute(req("/api/v1/search?q=broken", { key: requesterKey }), params())).json();
    expect(mine.tickets.length).toBe(1);
    const other = await (await searchRoute(req("/api/v1/search?q=broken", { key: otherKey }), params())).json();
    expect(other.tickets.length).toBe(0);
  });
});
