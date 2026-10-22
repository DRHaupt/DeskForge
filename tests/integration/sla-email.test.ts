import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/server/session", () => ({ getCurrentActor: async () => null }));

import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { syncConfigToDatabase } from "@/server/config-sync";
import { onTicketEvent } from "@/server/events";
import { MemoryTransport, setMailTransport } from "@/server/mail/transport";
import { parseRawEmail, processInbound, stripQuotedReply } from "@/server/mail/inbound";
import { reconcileTicketSla, sweepSla } from "@/server/sla";
import { notifyForEvent } from "@/server/services/notifications";
import { addComment, createTicket, getTicket, transitionTicket } from "@/server/services/tickets";
import { POST as inboundRoute } from "@/app/api/inbound/email/route";
import type { UserActor } from "@/core/rbac/actor";
import { actorFor, makeUser, setupBusiness } from "./helpers";

const mail = new MemoryTransport();
let agent: UserActor, requester: UserActor;
let escalationTeamId: string;

beforeAll(async () => {
  process.env.INBOUND_EMAIL_SECRET = "test-inbound-secret";
  const cfg = await setupBusiness("msp-it-support");
  setMailTransport(mail);
  const sd = await db.team.findUniqueOrThrow({ where: { key: "service_desk" } });
  escalationTeamId = (await db.team.findUniqueOrThrow({ where: { key: "systems" } })).id;
  const a = await makeUser("mia.chen@northbeam-it.example", ["agent"], { name: "Mia Chen" });
  const lead = await makeUser("dana.whitfield@northbeam-it.example", ["team_lead"], { name: "Dana Whitfield" });
  await db.teamMember.createMany({ data: [{ teamId: sd.id, userId: a.id }, { teamId: sd.id, userId: lead.id, isLead: true, isAvailable: false }] });
  const acme = await db.organization.findUniqueOrThrow({ where: { slug: "acme-dental" } });
  const r = await makeUser("rita@acmedental.example", ["requester"], { name: "Rita Requester", organizationId: acme.id });
  await syncConfigToDatabase(db, cfg);
  [agent, requester] = await Promise.all([actorFor(a.id), actorFor(r.id)]);
  // Simulate the worker: run notifications for every event.
  onTicketEvent(async (e) => notifyForEvent(e));
});

beforeEach(() => {
  mail.sent.length = 0;
});

describe("SLA timers", () => {
  it("start on creation from the matching policy (P1 is 24/7)", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Everything is down", impact: "company", urgency: "critical" });
    const timers = await db.sLAInstance.findMany({ where: { ticketId: t.id } });
    expect(timers.map((x) => x.metric).sort()).toEqual(["FIRST_RESPONSE", "RESOLUTION"]);
    const fr = timers.find((x) => x.metric === "FIRST_RESPONSE")!;
    expect(fr.targetMins).toBe(15);
    expect(fr.dueAt.getTime() - fr.startedAt.getTime()).toBe(15 * 60000);
  });

  it("first response stops on the first public agent reply", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Printer down", impact: "company", urgency: "critical" });
    await addComment(agent, t.id, { body: "internal", visibility: "INTERNAL" });
    expect((await db.sLAInstance.findFirstOrThrow({ where: { ticketId: t.id, metric: "FIRST_RESPONSE" } })).status).toBe("RUNNING");
    await addComment(agent, t.id, { body: "On it!" });
    expect((await db.sLAInstance.findFirstOrThrow({ where: { ticketId: t.id, metric: "FIRST_RESPONSE" } })).status).toBe("MET");
  });

  it("pauses while waiting on the customer and resumes when they reply", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Pause test", impact: "company", urgency: "critical" });
    await transitionTicket(agent, t.id, { to: "in_progress" });
    await transitionTicket(agent, t.id, { to: "waiting_on_customer" });
    expect((await db.sLAInstance.findFirstOrThrow({ where: { ticketId: t.id, metric: "RESOLUTION" } })).status).toBe("PAUSED");
    await addComment(requester, t.id, { body: "Here's the info", format: "text" });
    const res = await db.sLAInstance.findFirstOrThrow({ where: { ticketId: t.id, metric: "RESOLUTION" } });
    expect(res.status).toBe("RUNNING");
    expect((await getTicket(agent, t.id)).status).toBe("open");
  });

  it("sweep fires breach, escalates per config and notifies", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Breach me", impact: "company", urgency: "critical" });
    // Pretend the ticket was created 5 hours ago.
    const past = new Date(Date.now() - 5 * 3600_000);
    await db.ticket.update({ where: { id: t.id }, data: { createdAt: past } });
    await db.sLAInstance.deleteMany({ where: { ticketId: t.id } });
    await reconcileTicketSla(t.id);
    const result = await sweepSla();
    expect(result.breached).toBeGreaterThanOrEqual(2);
    const timers = await db.sLAInstance.findMany({ where: { ticketId: t.id } });
    expect(timers.every((x) => x.breachedAt)).toBe(true);
    // msp config: reassignOnBreach → moves to the escalation team (systems)
    const after = await getTicket({ kind: "system", label: "test" }, t.id);
    expect(after.teamId).toBe(escalationTeamId);
    const notes = await db.notification.findMany({ where: { ticketId: t.id, type: "sla.breached" } });
    expect(notes.length).toBeGreaterThan(0);
    expect(mail.sent.some((m) => m.subject.startsWith("SLA breached"))).toBe(true);
    // Idempotent: a second sweep does nothing for this ticket.
    expect((await sweepSla()).breached).toBe(0);
  });

  it("resolution stops the clock", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Resolve me", impact: "company", urgency: "critical" });
    await transitionTicket(agent, t.id, { to: "resolved", comment: "Fixed" });
    const res = await db.sLAInstance.findFirstOrThrow({ where: { ticketId: t.id, metric: "RESOLUTION" } });
    expect(res.status).toBe("MET");
  });
});

describe("outbound email", () => {
  it("acknowledges new tickets to the requester with a threadable Message-ID", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Ack test" });
    const ack = mail.sent.find((m) => m.to === "rita@acmedental.example");
    expect(ack?.subject).toBe(`[${t.number}] Ack test`);
    expect(ack?.messageId).toMatch(new RegExp(`^<${t.number}\\.`));
    expect(ack?.references?.[0]).toBe(`<ticket-${t.number}@northbeam-it.example>`);
    expect(ack?.html).toContain("Northbeam Managed IT");
    const row = await db.outboundEmail.findFirstOrThrow({ where: { ticketId: t.id } });
    expect(row.status).toBe("SENT");
  });

  it("sends one email when resolving with a comment (no duplicate reply email)", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Resolve email" });
    mail.sent.length = 0;
    await transitionTicket(agent, t.id, { to: "resolved", comment: "Replaced the cable" });
    const toRequester = mail.sent.filter((m) => m.to === "rita@acmedental.example" && !m.subject.startsWith("How did we do"));
    expect(toRequester).toHaveLength(1);
    // CSAT is on in this config: the survey goes out separately.
    expect(mail.sent.some((m) => m.subject.startsWith("How did we do") && m.to === "rita@acmedental.example")).toBe(true);
    expect(toRequester[0]!.subject).toMatch(/^Resolved: /);
    expect(toRequester[0]!.html).toContain("Replaced the cable");
  });

  it("never emails internal notes to the requester", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Secret" });
    mail.sent.length = 0;
    await addComment(agent, t.id, { body: "do not leak", visibility: "INTERNAL" });
    expect(mail.sent.some((m) => m.to === "rita@acmedental.example")).toBe(false);
  });

  it("respects the per-user email preference", async () => {
    await db.user.update({ where: { id: requester.id }, data: { notifyByEmail: false } });
    const t = await createTicket(requester, { type: "incident", title: "Quiet please" });
    await addComment(agent, t.id, { body: "reply" });
    expect(mail.sent.some((m) => m.to === "rita@acmedental.example")).toBe(false);
    await db.user.update({ where: { id: requester.id }, data: { notifyByEmail: true } });
  });

  it("notifies the assignee in-app when a requester replies", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Ping the agent" });
    const ticket = await getTicket(agent, t.id);
    await addComment(requester, t.id, { body: "any update?", format: "text" });
    const n = await db.notification.findFirst({ where: { ticketId: t.id, userId: ticket.assigneeId!, type: "ticket.customer_reply" } });
    expect(n).toBeTruthy();
  });
});

const raw = (h: Record<string, string>, body: string) =>
  Object.entries({ "MIME-Version": "1.0", "Content-Type": "text/plain; charset=utf-8", Date: new Date().toUTCString(), ...h })
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n") + `\r\n\r\n${body}`;

describe("inbound email", () => {
  it("strips quoted replies", () => {
    expect(stripQuotedReply("Thanks, that worked!\n\nOn Mon, 5 Jan 2026 at 10:00, Help <help@x.com> wrote:\n> old stuff")).toBe("Thanks, that worked!");
    expect(stripQuotedReply("New info\n##- Please type your reply above this line -##\nold")).toBe("New info");
    expect(stripQuotedReply("Hi\n-----Original Message-----\nFrom: a")).toBe("Hi");
  });

  it("creates a ticket from a new email, routed by mailbox, with CCs as watchers", async () => {
    const msg = await parseRawEmail(raw({ From: "New Person <new.person@brightsidelaw.example>", To: "help@northbeam-it.example", Cc: "boss@brightsidelaw.example", Subject: "Scanner not working", "Message-ID": "<abc123@mail.example>" }, "The scanner shows error E42."));
    const res = await processInbound(msg);
    expect(res.status).toBe("CREATED_TICKET");
    const t = await getTicket({ kind: "system", label: "t" }, res.ticketId!);
    expect(t.source).toBe("EMAIL");
    expect(t.requester.email).toBe("new.person@brightsidelaw.example");
    expect(t.organization?.name).toBe("Brightside Law LLP");
    expect(t.watchers.map((w) => w.email)).toContain("boss@brightsidelaw.example");
    expect(t.descriptionText).toContain("E42");
    // Duplicate delivery is ignored
    expect((await processInbound(msg)).status).toBe("IGNORED");
  });

  it("threads a reply to our notification back onto the ticket", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Thread me" });
    const ack = mail.sent.find((m) => m.subject.includes(t.number))!;
    const reply = await parseRawEmail(
      raw(
        { From: "Rita <rita@acmedental.example>", To: "help@northbeam-it.example", Subject: `Re: [${t.number}] Thread me`, "Message-ID": "<reply-1@acmedental.example>", "In-Reply-To": ack.messageId, References: ack.messageId },
        "It's still broken after restarting.\n\nOn Tue, Help wrote:\n> ##- Please type your reply above this line -##\n> We've received your request",
      ),
    );
    const res = await processInbound(reply);
    expect(res.status).toBe("APPENDED_COMMENT");
    expect(res.ticketId).toBe(t.id);
    const c = await db.comment.findUniqueOrThrow({ where: { id: res.commentId! } });
    expect(c.bodyText).toBe("It's still broken after restarting.");
    expect(c.source).toBe("EMAIL");
  });

  it("threads by ticket number in the subject when headers are missing", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Subject threading" });
    const res = await processInbound(await parseRawEmail(raw({ From: "rita@acmedental.example", To: "help@northbeam-it.example", Subject: `RE: ${t.number}`, "Message-ID": "<s-1@x>" }, "more info")));
    expect(res.ticketId).toBe(t.id);
  });

  it("does not let strangers post into someone else's ticket", async () => {
    const t = await createTicket(requester, { type: "incident", title: "Private thread" });
    const res = await processInbound(await parseRawEmail(raw({ From: "stranger@evil.example", To: "help@northbeam-it.example", Subject: `Re: [${t.number}] Private thread`, "Message-ID": "<x-9@evil>" }, "let me in")));
    expect(res.status).toBe("CREATED_TICKET");
    expect(res.ticketId).not.toBe(t.id);
  });

  it("ignores auto-replies, bulk mail and our own address", async () => {
    expect((await processInbound(await parseRawEmail(raw({ From: "rita@acmedental.example", To: "help@northbeam-it.example", Subject: "Out of office", "Auto-Submitted": "auto-replied", "Message-ID": "<ooo@x>" }, "away")))).status).toBe("IGNORED");
    expect((await processInbound(await parseRawEmail(raw({ From: "news@shop.example", To: "help@northbeam-it.example", Subject: "Sale", Precedence: "bulk", "Message-ID": "<b@x>" }, "50% off")))).status).toBe("IGNORED");
    expect((await processInbound(await parseRawEmail(raw({ From: "help@northbeam-it.example", To: "help@northbeam-it.example", Subject: "loop", "Message-ID": "<l@x>" }, "loop")))).status).toBe("IGNORED");
    expect((await processInbound(await parseRawEmail(raw({ From: "noreply@vendor.example", To: "help@northbeam-it.example", Subject: "x", "Message-ID": "<n@x>" }, "x")))).status).toBe("IGNORED");
  });

  it("webhook accepts raw MIME and Postmark JSON, and requires the secret", async () => {
    const noSecret = await inboundRoute(new NextRequest("http://localhost/api/inbound/email", { method: "POST", headers: { "content-type": "message/rfc822" }, body: "x" }));
    expect(noSecret.status).toBe(401);
    const rawRes = await inboundRoute(
      new NextRequest("http://localhost/api/inbound/email?secret=test-inbound-secret", {
        method: "POST",
        headers: { "content-type": "message/rfc822" },
        body: raw({ From: "Raw Sender <raw@harborbakery.example>", To: "security@northbeam-it.example", Subject: "Phishing email received", "Message-ID": "<raw-1@x>" }, "Suspicious link attached"),
      }),
    );
    const rawJson = await rawRes.json();
    expect(rawJson.status).toBe("CREATED_TICKET");
    const t = await getTicket({ kind: "system", label: "t" }, rawJson.ticketId);
    expect(t.team?.key).toBe("security"); // routed by the security mailbox
    const pm = await inboundRoute(
      new NextRequest("http://localhost/api/inbound/email?secret=test-inbound-secret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ FromFull: { Email: "pm@harborbakery.example", Name: "PM User" }, To: "help@northbeam-it.example", Subject: "Till is frozen", TextBody: "The till froze", MessageID: "pm-1", Headers: [] }),
      }),
    );
    expect((await pm.json()).status).toBe("CREATED_TICKET");
  });
});
