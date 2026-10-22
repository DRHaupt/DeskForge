import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/server/session", () => ({ getCurrentActor: async () => null }));

import { db } from "@/server/db";
import { syncConfigToDatabase } from "@/server/config-sync";
import {
  addComment, assignTicket, bulkUpdate, createTicket, getTicket, getTimeline, linkTicket, listTickets, mergeTickets,
  ticketFieldValues, ticketFilterSchema, transitionTicket, transitionsFor, updateTicket,
} from "@/server/services/tickets";
import { getSearchProvider } from "@/server/search";
import { systemActor, type UserActor } from "@/core/rbac/actor";
import { NotFoundError } from "@/core/errors";
import { WorkflowError } from "@/core/workflow/engine";
import { actorFor, makeUser, setupBusiness } from "./helpers";

let agentA: UserActor, agentB: UserActor, lead: UserActor, requester: UserActor, otherRequester: UserActor, outsider: UserActor;
let serviceDeskId: string, systemsId: string;

beforeAll(async () => {
  const cfg = await setupBusiness("msp-it-support");
  const acme = await db.organization.findUniqueOrThrow({ where: { slug: "acme-dental" } });
  const a = await makeUser("alice@northbeam-it.example", ["agent"], { name: "Alice Agent" });
  const b = await makeUser("bob@northbeam-it.example", ["agent"], { name: "Bob Agent" });
  const l = await makeUser("lena@northbeam-it.example", ["team_lead"], { name: "Lena Lead" });
  const o = await makeUser("oscar@northbeam-it.example", ["agent"], { name: "Oscar Outsider" });
  const r = await makeUser("rita@acmedental.example", ["requester"], { organizationId: acme.id, name: "Rita Requester" });
  const r2 = await makeUser("sam@acmedental.example", ["requester"], { organizationId: acme.id, name: "Sam Requester" });
  serviceDeskId = (await db.team.findUniqueOrThrow({ where: { key: "service_desk" } })).id;
  systemsId = (await db.team.findUniqueOrThrow({ where: { key: "systems" } })).id;
  await db.teamMember.createMany({ data: [{ teamId: serviceDeskId, userId: a.id }, { teamId: serviceDeskId, userId: b.id }, { teamId: systemsId, userId: o.id }, { teamId: serviceDeskId, userId: l.id, isLead: true, isAvailable: false }] });
  await syncConfigToDatabase(db, cfg);
  [agentA, agentB, lead, requester, otherRequester, outsider] = await Promise.all([a, b, l, r, r2, o].map((u) => actorFor(u.id)));
});

describe("create", () => {
  it("numbers tickets per type with the configured prefix", async () => {
    const t1 = await createTicket(requester, { type: "incident", title: "Printer offline", description: "<p>The front desk printer is offline</p>" });
    const t2 = await createTicket(requester, { type: "incident", title: "Email not syncing" });
    const r1 = await createTicket(requester, { type: "service_request", title: "Need a new monitor" });
    expect(t1.number).toBe("INC0000001");
    expect(t2.number).toBe("INC0000002");
    expect(r1.number).toBe("REQ0000001");
  });

  it("allocates unique numbers under concurrency", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => createTicket(agentA, { type: "service_request", title: `Concurrent ${i}`, requesterId: requester.id })));
    expect(new Set(results.map((r) => r.number)).size).toBe(10);
  });

  it("routes to the type's default team, round-robins among available members and sets org", async () => {
    const t = await getTicket(lead, (await createTicket(requester, { type: "incident", title: "Wi-Fi down in reception" })).id);
    expect(t.teamId).toBe(serviceDeskId);
    expect(t.organizationId).toBe(requester.organizationId);
    expect([agentA.id, agentB.id]).toContain(t.assigneeId);
    const next = await getTicket(lead, (await createTicket(requester, { type: "incident", title: "Second one" })).id);
    expect(next.assigneeId).not.toBe(t.assigneeId); // round robin moves on
    expect(next.assigneeId).not.toBe(lead.id); // lead is marked unavailable
  });

  it("derives priority from impact × urgency", async () => {
    const t = await getTicket(lead, (await createTicket(requester, { type: "incident", title: "Whole office offline", impact: "company", urgency: "critical" })).id);
    expect(t.priority).toBe("p1");
  });

  it("validates custom fields against config", async () => {
    await expect(createTicket(requester, { type: "incident", title: "Bad field", fields: { environment: "Mars" } })).rejects.toThrow();
    await expect(createTicket(requester, { type: "change", title: "Not from portal" })).rejects.toThrow(/Unknown ticket type|can't be created/);
    const ok = await createTicket(agentA, { type: "change", title: "Patch firewall", requesterId: requester.id, fields: { change_type: "Normal" } });
    expect(ok.number).toMatch(/^CHG/);
    // Changes route to Systems; agentA isn't in that team, so only the lead can see it now.
    await expect(getTicket(agentA, ok.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(ticketFieldValues(await getTicket(lead, ok.id))).toEqual({ change_type: "Normal" });
  });

  it("stops requesters from setting staff-only fields", async () => {
    await expect(createTicket(requester, { type: "incident", title: "Sneaky", priority: "p1" })).rejects.toThrow(/Only agents/);
  });

  it("sanitizes rich text", async () => {
    const t = await createTicket(requester, { type: "incident", title: "XSS attempt", description: '<p onclick="x()">Hi<script>alert(1)</script><img src="javascript:alert(1)"></p>' });
    const full = await getTicket(lead, t.id);
    expect(full.description).toBe("<p>Hi<img /></p>");
    expect(full.descriptionText).toBe("Hi");
  });
});

describe("visibility", () => {
  it("hides other requesters' tickets (as not found)", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Private" });
    await expect(getTicket(otherRequester, t.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getTicket(outsider, t.id)).rejects.toBeInstanceOf(NotFoundError); // agent in another team
    expect((await getTicket(agentA, t.id)).id).toBe(t.id);
    const list = await listTickets(otherRequester, ticketFilterSchema.parse({}));
    expect(list.items.every((i) => i.requesterId === otherRequester.id)).toBe(true);
  });

  it("org access lets a requester see colleagues' tickets", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Org visible" });
    await db.user.update({ where: { id: otherRequester.id }, data: { orgTicketAccess: true } });
    const withOrg = await actorFor(otherRequester.id);
    expect((await getTicket(withOrg, t.id)).id).toBe(t.id);
    await db.user.update({ where: { id: otherRequester.id }, data: { orgTicketAccess: false } });
  });
});

describe("workflow", () => {
  it("enforces transitions, roles and required comments", async () => {
    const { id } = await createTicket(requester, { type: "incident", title: "Workflow test" });
    expect(transitionsFor(agentA, await getTicket(agentA, id)).map((t) => t.to)).toContain("in_progress");
    expect(transitionsFor(requester, await getTicket(requester, id)).map((t) => t.to)).toEqual(["closed"]);
    await transitionTicket(agentA, id, { to: "in_progress" });
    await expect(transitionTicket(agentA, id, { to: "resolved" })).rejects.toBeInstanceOf(WorkflowError);
    await expect(transitionTicket(requester, id, { to: "resolved", comment: "fixed" })).rejects.toThrow(/not allowed/);
    const res = await transitionTicket(agentA, id, { to: "resolved", comment: "Replaced the toner" });
    expect(res.statusCategory).toBe("RESOLVED");
    const t = await getTicket(agentA, id);
    expect(t.resolvedAt).toBeTruthy();
    expect(t.firstRespondedAt).toBeTruthy(); // resolution comment is public → counts as response
    const timeline = await getTimeline(requester, t);
    expect(timeline.filter((i) => i.kind === "status").map((i) => (i as { to: string }).to)).toEqual(["new", "in_progress", "resolved"]);
  });

  it("requester reply reopens a resolved ticket and counts the reopen", async () => {
    const { id } = await createTicket(requester, { type: "incident", title: "Reopen test" });
    await transitionTicket(agentA, id, { to: "resolved", comment: "Should be fine now" });
    await addComment(requester, id, { body: "Still broken!", format: "text" });
    const t = await getTicket(agentA, id);
    expect(t.status).toBe("open");
    expect(t.reopenCount).toBe(1);
    expect(t.resolvedAt).toBeNull();
  });
});

describe("comments", () => {
  it("hides internal notes from requesters and blocks them from writing one", async () => {
    const { id } = await createTicket(requester, { type: "incident", title: "Notes" });
    await addComment(agentA, id, { body: "<p>Check the switch in rack 2</p>", visibility: "INTERNAL" });
    await addComment(agentA, id, { body: "<p>We're looking into it</p>" });
    await expect(addComment(requester, id, { body: "x", visibility: "INTERNAL" })).rejects.toThrow(/Missing permission/);
    const forRequester = await getTimeline(requester, await getTicket(requester, id));
    const comments = forRequester.filter((i) => i.kind === "comment");
    expect(comments).toHaveLength(1);
    const forAgent = (await getTimeline(agentA, await getTicket(agentA, id))).filter((i) => i.kind === "comment");
    expect(forAgent).toHaveLength(2);
    const t = await getTicket(agentA, id);
    expect(t.firstRespondedAt).toBeTruthy();
  });

  it("records mentions of agents and adds them as watchers", async () => {
    const { id } = await createTicket(requester, { type: "incident", title: "Mentions" });
    const c = await addComment(agentA, id, { body: `<p>Hey <span data-type="mention" data-id="${agentB.id}" data-label="Bob">@Bob</span> and <span data-type="mention" data-id="${requester.id}">@Rita</span></p>`, visibility: "INTERNAL" });
    const row = await db.comment.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.mentions).toEqual([agentB.id]);
    expect(await db.ticketWatcher.count({ where: { ticketId: id, userId: agentB.id } })).toBe(1);
  });
});

describe("assignment", () => {
  it("agents may take tickets but not reassign others' tickets across teams", async () => {
    const { id } = await createTicket(lead, { type: "incident", title: "Assign test", requesterId: requester.id, assigneeId: null, teamId: serviceDeskId });
    await assignTicket(agentA, id, { assigneeId: agentA.id });
    await expect(assignTicket(agentB, id, { assigneeId: agentB.id })).rejects.toThrow(/assigned to someone else/);
    await expect(assignTicket(agentA, id, { teamId: systemsId })).rejects.toThrow(/own teams/);
    await assignTicket(lead, id, { teamId: systemsId, assigneeId: outsider.id });
    const t = await getTicket(lead, id);
    expect(t.teamId).toBe(systemsId);
    expect(t.assigneeId).toBe(outsider.id);
  });

  it("rejects non-agents as assignees", async () => {
    const { id } = await createTicket(requester, { type: "incident", title: "Bad assignee" });
    await expect(assignTicket(lead, id, { assigneeId: requester.id })).rejects.toThrow(/active agent/);
  });
});

describe("update, links, merge, bulk", () => {
  it("updates fields, tags and recomputes priority from impact/urgency", async () => {
    const { id } = await createTicket(requester, { type: "incident", title: "Update me" });
    const res = await updateTicket(agentA, id, { impact: "company", urgency: "critical", tags: ["Outage", "network"], fields: { affected_users: 40 } });
    expect(res.changes.priority?.to).toBe("p1");
    const t = await getTicket(agentA, id);
    expect(t.tags.map((x) => x.tag.name).sort()).toEqual(["network", "outage"]);
    expect(ticketFieldValues(t).affected_users).toBe(40);
    await expect(updateTicket(requester, id, { title: "hack" })).rejects.toThrow(/Missing permission/);
  });

  it("links parent/child and prevents loops", async () => {
    const p = await createTicket(agentA, { type: "incident", title: "Parent", requesterId: requester.id });
    const c = await createTicket(agentA, { type: "incident", title: "Child", requesterId: requester.id });
    await linkTicket(agentA, p.id, { type: "PARENT_CHILD", target: c.number });
    await expect(linkTicket(agentA, c.id, { type: "PARENT_CHILD", target: p.number })).rejects.toThrow(/loop/);
    await expect(linkTicket(agentA, p.id, { type: "PARENT_CHILD", target: c.number })).rejects.toThrow(/already linked/);
    const parent = await getTicket(agentA, p.id);
    expect(parent.outgoingLinks[0]?.targetTicket?.number).toBe(c.number);
  });

  it("merges a duplicate into the original", async () => {
    const orig = await createTicket(requester, { type: "incident", title: "VPN broken" });
    const dup = await createTicket(otherRequester, { type: "incident", title: "VPN not working" });
    await addComment(otherRequester, dup.id, { body: "Same here", format: "text" });
    await mergeTickets(agentA, dup.id, orig.number);
    const d = await getTicket(agentA, dup.id);
    expect(d.mergedIntoId).toBe(orig.id);
    expect(d.statusCategory).toBe("CLOSED");
    const o = await getTicket(agentA, orig.id);
    expect(o.watchers.some((w) => w.userId === otherRequester.id)).toBe(true);
    // The duplicate's requester can now see the original as a watcher.
    expect((await getTicket(otherRequester, orig.id)).id).toBe(orig.id);
    const comments = await db.comment.findMany({ where: { ticketId: orig.id } });
    expect(comments.some((c) => c.bodyText === "Same here")).toBe(true);
  });

  it("bulk updates and reports per-ticket failures", async () => {
    const a = await createTicket(requester, { type: "incident", title: "Bulk A" });
    const b = await createTicket(requester, { type: "incident", title: "Bulk B" });
    const res = await bulkUpdate(lead, { ids: [a.id, b.id, "missing"], priority: "p2", addTags: ["bulk"] });
    expect(res.ok).toBe(2);
    expect(res.failed).toBe(1);
    expect((await getTicket(lead, a.id)).priority).toBe("p2");
  });
});

describe("search", () => {
  it("finds tickets by words, prefixes and number, respecting visibility and internal notes", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Laptop battery swelling", description: "<p>The battery on my ThinkPad is swollen</p>" });
    await addComment(agentA, t.id, { body: "<p>Ordered replacement from supplier Zephyrcorp</p>", visibility: "INTERNAL" });
    const search = getSearchProvider();
    expect((await search.searchTickets(agentA, "batt swoll")).map((h) => h.id)).toContain(t.id);
    expect((await search.searchTickets(agentA, "zephyrcorp")).map((h) => h.id)).toContain(t.id);
    expect((await search.searchTickets(requester, "zephyrcorp")).map((h) => h.id)).not.toContain(t.id);
    expect((await search.searchTickets(otherRequester, "battery")).map((h) => h.id)).not.toContain(t.id);
    const full = await getTicket(agentA, t.id);
    expect((await search.searchTickets(agentA, full.number))[0]?.id).toBe(t.id);
  });

  it("system actor can do everything", async () => {
    const t = await createTicket(systemActor("test"), { type: "incident", title: "From automation", requesterId: requester.id });
    expect(t.number).toMatch(/^INC/);
  });
});
