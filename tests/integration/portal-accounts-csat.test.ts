import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/server/session", () => ({ getCurrentActor: async () => null }));

import { db } from "@/server/db";
import { MemoryTransport, setMailTransport } from "@/server/mail/transport";
import { confirmPasswordReset, requestPasswordReset, signup } from "@/server/services/account-flows";
import { answerSurvey } from "@/server/services/csat";
import { createTicket, transitionTicket, transitionsFor, getTicket } from "@/server/services/tickets";
import { verifyPassword } from "@/server/passwords";
import { POST as signupRoute } from "@/app/api/v1/public/signup/route";
import type { UserActor } from "@/core/rbac/actor";
import { actorFor, makeUser, params, req, setupBusiness } from "./helpers";

const mail = new MemoryTransport();
let agent: UserActor;

beforeAll(async () => {
  await setupBusiness("ecommerce-support");
  setMailTransport(mail);
  const team = await db.team.findUniqueOrThrow({ where: { key: "customer_care" } });
  const a = await makeUser("olivia.hart@fernleaf-home.example", ["agent"], { name: "Olivia Hart" });
  await db.teamMember.create({ data: { teamId: team.id, userId: a.id } });
  agent = await actorFor(a.id);
});

describe("public sign-up", () => {
  it("creates a requester and enforces the password policy", async () => {
    await expect(signup({ name: "Shopper", email: "shopper@customer.example", password: "short" })).rejects.toThrow(/at least 10/);
    const res = await signup({ name: "Shopper", email: "Shopper@Customer.example", password: "lovely-cushions-42" });
    const u = await db.user.findUniqueOrThrow({ where: { id: res.id }, include: { roles: { include: { role: true } } } });
    expect(u.email).toBe("shopper@customer.example");
    expect(u.roles.map((r) => r.role.key)).toEqual(["requester"]);
    await expect(signup({ name: "Again", email: "shopper@customer.example", password: "lovely-cushions-42" })).rejects.toThrow(/already exists/);
  });

  it("is rate limited", async () => {
    const statuses: number[] = [];
    // Limit is 5 per one-minute window; 12 attempts trip it even if the run straddles a window boundary.
    // A fresh IP per run, because counters live in Redis across test runs.
    const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < 12; i++) {
      const res = await signupRoute(req("/api/v1/public/signup", { body: { name: "Bot", email: `bot${i}-${Date.now()}@spam.example`, password: "lovely-cushions-42" }, headers: { "x-forwarded-for": ip } }), params());
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});

describe("password reset", () => {
  it("emails a one-time link and resets the password", async () => {
    mail.sent.length = 0;
    await requestPasswordReset("nobody@customer.example"); // no error, no email (no enumeration)
    expect(mail.sent).toHaveLength(0);
    await requestPasswordReset("shopper@customer.example");
    const link = mail.sent[0]!.html.match(/reset-password\?token=([\w-]+)/)![1]!;
    await expect(confirmPasswordReset({ token: link, password: "x" })).rejects.toThrow(/Password/);
    const res = await confirmPasswordReset({ token: link, password: "new-cushions-2026" });
    expect(res.email).toBe("shopper@customer.example");
    const u = await db.user.findUniqueOrThrow({ where: { email: "shopper@customer.example" } });
    expect(await verifyPassword("new-cushions-2026", u.passwordHash!)).toBe(true);
    expect(u.sessionVersion).toBe(1); // old sessions end
    await expect(confirmPasswordReset({ token: link, password: "again-cushions-2026" })).rejects.toThrow(/invalid or has expired/);
  });
});

describe("requester self-service and CSAT", () => {
  it("requester can solve their own ticket; a survey is created and answerable by token", async () => {
    const shopper = await actorFor((await db.user.findUniqueOrThrow({ where: { email: "shopper@customer.example" } })).id);
    const t = await createTicket(shopper, { type: "question", title: "Do you sell gift cards?" });
    expect(transitionsFor(shopper, await getTicket(shopper, t.id)).map((x) => x.to)).toEqual(["solved"]);
    mail.sent.length = 0;
    await transitionTicket(agent, t.id, { to: "solved", comment: "Yes — in any amount from £10." });
    const survey = await db.cSATResponse.findUniqueOrThrow({ where: { ticketId: t.id } });
    expect(mail.sent.some((m) => m.subject.startsWith("How did we do") && m.html.includes(`/csat/${survey.token}?rating=5`))).toBe(true);
    await answerSurvey(survey.token, { rating: 5, comment: "Fast!" });
    const answered = await db.cSATResponse.findUniqueOrThrow({ where: { ticketId: t.id } });
    expect(answered.rating).toBe(5);
    expect(answered.comment).toBe("Fast!");
    // Only one survey per ticket even if it is reopened and solved again.
    await transitionTicket(agent, t.id, { to: "open" });
    await transitionTicket(agent, t.id, { to: "solved", comment: "Again" });
    expect(await db.cSATResponse.count({ where: { ticketId: t.id } })).toBe(1);
  });
});
