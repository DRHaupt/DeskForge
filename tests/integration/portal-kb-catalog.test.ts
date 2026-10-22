import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/server/session", () => ({ getCurrentActor: async () => null }));

import { db } from "@/server/db";
import { syncConfigToDatabase } from "@/server/config-sync";
import { MemoryTransport, setMailTransport } from "@/server/mail/transport";
import { articleFeedback, createArticle, getArticle, listArticles, articleListSchema, updateArticle } from "@/server/services/kb";
import { decideApproval, listMyApprovals, submitCatalogRequest } from "@/server/services/catalog";
import { getTicket } from "@/server/services/tickets";
import { getSearchProvider } from "@/server/search";
import { GET as suggestRoute } from "@/app/api/v1/kb/suggest/route";
import { GET as articlesRoute } from "@/app/api/v1/kb/articles/route";
import { NotFoundError } from "@/core/errors";
import type { UserActor } from "@/core/rbac/actor";
import { actorFor, makeUser, params, req, setupBusiness } from "./helpers";

const mail = new MemoryTransport();
let lead: UserActor, agent: UserActor, requester: UserActor, approver: UserActor;

beforeAll(async () => {
  const cfg = await setupBusiness("internal-it");
  setMailTransport(mail);
  const l = await makeUser("alex.morgan@riverside-club.example", ["team_lead"], { name: "Alex Morgan" });
  const a = await makeUser("sam.rivera@riverside-club.example", ["agent"], { name: "Sam Rivera" });
  const r = await makeUser("member@riverside-club.example", ["requester"], { name: "Club Member" });
  await syncConfigToDatabase(db, cfg); // links config approvers + team members now that users exist
  [lead, agent, requester] = await Promise.all([actorFor(l.id), actorFor(a.id), actorFor(r.id)]);
  approver = lead;
});

describe("knowledge base", () => {
  let publicId: string, internalId: string, draftId: string;

  beforeAll(async () => {
    publicId = (await createArticle(lead, { title: "Connect to the club Wi-Fi", body: "<p>Choose RTC-Members and sign in with your club account.</p>", tags: ["wifi"], status: "PUBLISHED" })).id;
    internalId = (await createArticle(lead, { title: "Wi-Fi controller admin runbook", body: "<p>Controller at 10.0.0.2</p>", visibility: "INTERNAL", status: "PUBLISHED" })).id;
    draftId = (await createArticle(agent, { title: "Wi-Fi guest vouchers", body: "<p>Draft</p>" })).id;
  });

  it("anonymous visitors see only published public articles", async () => {
    const list = await listArticles(null, articleListSchema.parse({}));
    expect(list.items.map((i) => i.id)).toEqual([publicId]);
    await expect(getArticle(null, internalId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getArticle(null, draftId)).rejects.toBeInstanceOf(NotFoundError);
    const viaApi = await (await articlesRoute(req("/api/v1/kb/articles"), params())).json();
    expect(viaApi.items).toHaveLength(1);
  });

  it("agents see internal articles and drafts", async () => {
    const list = await listArticles(agent, articleListSchema.parse({}));
    expect(list.items).toHaveLength(3);
  });

  it("authors can't publish; publishers can", async () => {
    await expect(updateArticle(agent, draftId, { status: "PUBLISHED" })).rejects.toThrow(/publishers/);
    await expect(createArticle(agent, { title: "Sneaky publish", body: "x", status: "PUBLISHED" })).rejects.toThrow(/Missing permission: kb.publish/);
    await updateArticle(lead, draftId, { status: "PUBLISHED" });
    expect((await getArticle(null, draftId)).status).toBe("PUBLISHED");
  });

  it("requesters can't author", async () => {
    await expect(createArticle(requester, { title: "Hmm", body: "x" })).rejects.toThrow(/Missing permission/);
  });

  it("counts feedback once per user and allows changing the vote", async () => {
    await articleFeedback(requester, publicId, { helpful: true });
    await articleFeedback(requester, publicId, { helpful: false, comment: "Didn't mention passwords" });
    await articleFeedback(null, publicId, { helpful: true });
    const a = await db.knowledgeArticle.findUniqueOrThrow({ where: { id: publicId } });
    expect(a.helpfulCount).toBe(1);
    expect(a.notHelpfulCount).toBe(1);
  });

  it("search and suggestions respect visibility", async () => {
    const anon = await getSearchProvider().searchArticles(null, "wifi controller");
    expect(anon).toHaveLength(0);
    const staff = await getSearchProvider().searchArticles(agent, "controller");
    expect(staff.map((h) => h.id)).toContain(internalId);
    const sug = await (await suggestRoute(req("/api/v1/kb/suggest?q=club%20wifi"), params())).json();
    expect(sug.articles.map((a: { id: string }) => a.id)).toContain(publicId);
  });
});

describe("service catalog with approval", () => {
  it("validates the item's form", async () => {
    await expect(submitCatalogRequest(requester, "loaner_laptop", { values: { pickup_date: "2026-11-01" } })).rejects.toThrow();
  });

  it("creates an unassigned ticket waiting for the named approver, then approval assigns it", async () => {
    mail.sent.length = 0;
    const res = await submitCatalogRequest(requester, "loaner_laptop", { values: { pickup_date: "2026-11-01", return_date: "2026-11-14", purpose: "Robotics workshop" } });
    expect(res.approvalStatus).toBe("PENDING");
    const t = await getTicket(lead, res.id);
    expect(t.assigneeId).toBeNull();
    expect(t.source).toBe("CATALOG");
    expect(t.descriptionText).toContain("Robotics workshop");
    expect(mail.sent.some((m) => m.to === "alex.morgan@riverside-club.example" && m.subject.startsWith("Approval needed"))).toBe(true);

    const pending = await listMyApprovals(approver);
    const mine = pending.find((p) => p.ticketId === res.id)!;
    await expect(decideApproval(agent, mine.id, { decision: "APPROVED" })).rejects.toThrow(/isn't assigned to you/);
    await decideApproval(approver, mine.id, { decision: "APPROVED", comment: "Enjoy!" });
    const after = await getTicket(lead, res.id);
    expect(after.catalogRequest?.approvalStatus).toBe("APPROVED");
    expect(after.assigneeId).not.toBeNull(); // help_desk is round robin
    await expect(decideApproval(approver, mine.id, { decision: "REJECTED", comment: "no" })).rejects.toThrow(/already decided/);
  });

  it("rejection needs a reason and closes the ticket", async () => {
    const res = await submitCatalogRequest(requester, "loaner_laptop", { values: { pickup_date: "2026-11-01", return_date: "2026-11-02", purpose: "Gaming" } });
    const a = (await listMyApprovals(approver)).find((p) => p.ticketId === res.id)!;
    await expect(decideApproval(approver, a.id, { decision: "REJECTED" })).rejects.toThrow(/reason/);
    await decideApproval(approver, a.id, { decision: "REJECTED", comment: "Loaners are for club projects only" });
    const t = await getTicket(lead, res.id);
    expect(t.statusCategory).toBe("CLOSED");
    expect(mail.sent.some((m) => m.subject.includes(t.number) && m.html.includes("was not approved"))).toBe(true);
  });

  it("items without approval go straight to the queue", async () => {
    const res = await submitCatalogRequest(requester, "shared_drive_access", { values: { folder: "Robotics", access_level: "Edit" } });
    expect(res.approvalStatus).toBe("NOT_REQUIRED");
    expect((await getTicket(lead, res.id)).assigneeId).not.toBeNull();
  });
});
