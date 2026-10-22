import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/server/session", () => ({ getCurrentActor: async () => null }));

import { db } from "@/server/db";
import { syncConfigToDatabase } from "@/server/config-sync";
import { MemoryTransport, setMailTransport } from "@/server/mail/transport";
import { createTicket, getTicket, transitionTicket, updateTicket } from "@/server/services/tickets";
import { decideApproval, listMyApprovals } from "@/server/services/catalog";
import { listKnownErrors, raiseProblem, workaroundsFor } from "@/server/services/problems";
import { ForbiddenError, ValidationError } from "@/core/errors";
import type { UserActor } from "@/core/rbac/actor";
import { actorFor, makeUser, setupBusiness } from "./helpers";

const mail = new MemoryTransport();
let dana: UserActor, raj: UserActor, emma: UserActor, requester: UserActor;

beforeAll(async () => {
  const cfg = await setupBusiness("msp-it-support");
  setMailTransport(mail);
  const d = await makeUser("dana.whitfield@northbeam-it.example", ["team_lead"], { name: "Dana Whitfield" });
  const r = await makeUser("raj.patel@northbeam-it.example", ["agent"], { name: "Raj Patel" });
  const e = await makeUser("emma.novak@northbeam-it.example", ["agent"], { name: "Emma Novak" });
  const q = await makeUser("pat@acmedental.example", ["requester"], { name: "Pat Client" });
  await syncConfigToDatabase(db, cfg);
  [dana, raj, emma, requester] = await Promise.all([actorFor(d.id), actorFor(r.id), actorFor(e.id), actorFor(q.id)]);
});

async function newChange(risk: string | null, title = "Upgrade the firewall firmware") {
  const { id } = await createTicket(emma, { type: "change", title, fields: { change_type: "Normal" } });
  if (risk) await updateTicket(emma, id, { riskLevel: risk, changePlan: "Apply firmware 7.4 in the maintenance window", rollbackPlan: "Reflash 7.2" });
  return id;
}

describe("change management and the CAB", () => {
  it("requires a risk level before submitting", async () => {
    const id = await newChange(null);
    await expect(transitionTicket(emma, id, { to: "awaiting_approval" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("requesters can't create changes and agents need change.manage", async () => {
    await expect(createTicket(requester, { type: "change", title: "Let me change things", fields: { change_type: "Normal" } })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("sends high-risk changes to the CAB and approves on quorum", async () => {
    const id = await newChange("high");
    mail.sent.length = 0;
    await transitionTicket(emma, id, { to: "awaiting_approval" });
    let t = await getTicket(dana, id);
    expect(t.status).toBe("awaiting_approval");
    expect(t.cabStatus).toBe("PENDING");
    const votes = await db.approval.findMany({ where: { ticketId: id, kind: "CHANGE_CAB" }, include: { approver: true } });
    expect(votes.map((v) => v.approver.email).sort()).toEqual(["dana.whitfield@northbeam-it.example", "raj.patel@northbeam-it.example"]);
    expect(mail.sent.some((m) => m.subject.startsWith("CAB review needed"))).toBe(true);

    // Nobody can skip the CAB by hand, and risk is locked during review.
    await expect(transitionTicket(dana, id, { to: "approved" })).rejects.toThrow(/waiting for the CAB/);
    await expect(updateTicket(emma, id, { riskLevel: "low" })).rejects.toThrow(/risk level can't change/);

    const rajVote = (await listMyApprovals(raj)).find((a) => a.ticketId === id)!;
    await decideApproval(raj, rajVote.id, { decision: "APPROVED", comment: "Looks safe" });
    t = await getTicket(dana, id);
    expect(t.status).toBe("approved");
    expect(t.cabStatus).toBe("APPROVED");
    expect((await listMyApprovals(dana)).find((a) => a.ticketId === id)).toBeUndefined();
  });

  it("rejects on any rejection and allows resubmission", async () => {
    const id = await newChange("medium", "Move file server to new VLAN");
    await transitionTicket(emma, id, { to: "awaiting_approval" });
    const vote = (await listMyApprovals(dana)).find((a) => a.ticketId === id)!;
    await expect(decideApproval(dana, vote.id, { decision: "REJECTED" })).rejects.toBeInstanceOf(ValidationError);
    await decideApproval(dana, vote.id, { decision: "REJECTED", comment: "No rollback tested" });
    let t = await getTicket(emma, id);
    expect(t.status).toBe("rejected");
    expect(t.cabStatus).toBe("REJECTED");

    await transitionTicket(emma, id, { to: "awaiting_approval" });
    t = await getTicket(emma, id);
    expect(t.cabStatus).toBe("PENDING");
    expect(await db.approval.count({ where: { ticketId: id, status: "PENDING" } })).toBe(2);
  });

  it("approves low-risk changes without the CAB", async () => {
    const id = await newChange("low", "Rotate Wi-Fi PSK");
    await transitionTicket(emma, id, { to: "awaiting_approval" });
    const t = await getTicket(emma, id);
    expect(t.status).toBe("approved");
    expect(t.cabStatus).toBe("NOT_REQUIRED");
    expect(await db.approval.count({ where: { ticketId: id } })).toBe(0);
  });
});

describe("problem management", () => {
  let incidentId: string, problemId: string, problemNumber: string;

  beforeAll(async () => {
    incidentId = (await createTicket(requester, { type: "incident", title: "Outlook keeps asking for my password" })).id;
  });

  it("raises a problem from an incident and links them", async () => {
    await expect(raiseProblem(requester, incidentId, {})).rejects.toBeInstanceOf(ForbiddenError);
    const p = await raiseProblem(dana, incidentId, { title: "Mail clients prompting for credentials" });
    problemId = p.id;
    problemNumber = p.number;
    expect(p.number).toMatch(/^PRB/);
    const link = await db.relationship.findFirst({ where: { type: "CAUSED_BY", sourceTicketId: incidentId, targetTicketId: problemId } });
    expect(link).not.toBeNull();
  });

  it("publishes known-error workarounds to linked incidents", async () => {
    await updateTicket(dana, problemId, { rootCause: "Expired modern-auth token cache", workaround: "Sign out of Office and back in", knownError: true });
    const notes = await db.comment.findMany({ where: { ticketId: incidentId, isSystem: true, visibility: "INTERNAL" } });
    expect(notes.some((n) => n.bodyText.includes("known error") && n.bodyText.includes("Sign out of Office"))).toBe(true);
    const ke = await listKnownErrors(emma, { includeResolved: false });
    expect(ke).toEqual([expect.objectContaining({ number: problemNumber, incidentCount: 1 })]);
    expect((await workaroundsFor(incidentId)).map((w) => w.number)).toEqual([problemNumber]);
    await expect(listKnownErrors(requester, { includeResolved: false })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("tells linked incidents when the problem is resolved", async () => {
    await transitionTicket(dana, problemId, { to: "investigating" });
    await transitionTicket(dana, problemId, { to: "resolved", comment: "Token lifetime policy fixed" });
    const notes = await db.comment.findMany({ where: { ticketId: incidentId, isSystem: true } });
    expect(notes.some((n) => n.bodyText.includes("has been resolved"))).toBe(true);
    expect(await listKnownErrors(emma, { includeResolved: false })).toEqual([]);
  });
});

describe("CAB bookkeeping", () => {
  it("closes open votes when a change leaves review without a CAB decision", async () => {
    const id = await newChange("high", "Replace core switch");
    await transitionTicket(emma, id, { to: "awaiting_approval" });
    await transitionTicket(dana, id, { to: "rejected", comment: "Not this quarter" });
    const t = await getTicket(emma, id);
    expect(t.cabStatus).toBe("REJECTED");
    expect(await db.approval.count({ where: { ticketId: id, status: "PENDING" } })).toBe(0);
  });
});
