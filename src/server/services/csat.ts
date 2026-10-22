/**
 * Customer satisfaction surveys (feature flag `csat`).
 *
 * When a ticket reaches `csat.sendOn` (resolved or closed) the requester gets
 * one survey per ticket, by email (one-click rating links) and in the portal.
 * Responses use an unguessable token, so rating from email needs no login.
 */
import { z } from "zod";
import { getConfig } from "@/core/config/loader";
import { NotFoundError, ValidationError } from "@/core/errors";
import { randomToken } from "../crypto";
import { db } from "../db";
import { onTicketEvent } from "../events";
import { queueEmail } from "../mail/outbound";
import { appUrl, escapeHtml } from "../mail/templates";
import { enqueue, QUEUES } from "../queue";
import { emailSideEffectsEnabled } from "../side-effects";

export function csatLabels(scale: 3 | 5): string[] {
  return scale === 3 ? ["Unhappy", "Okay", "Happy"] : ["Very unhappy", "Unhappy", "Okay", "Happy", "Very happy"];
}

/** Create the survey (idempotent) and send it now or after the configured delay. */
export async function scheduleCsat(ticketId: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg.features.csat) return;
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, select: { id: true, requesterId: true, statusCategory: true, mergedIntoId: true, csatResponse: true, source: true } });
  if (!ticket || ticket.csatResponse || ticket.mergedIntoId) return;
  const target = cfg.csat.sendOn === "resolved" ? ["RESOLVED", "CLOSED"] : ["CLOSED"];
  if (!target.includes(ticket.statusCategory)) return;
  const survey = await db.cSATResponse.create({ data: { ticketId, requesterId: ticket.requesterId, token: randomToken(24) } }).catch(() => null);
  if (!survey) return; // created concurrently
  if (!emailSideEffectsEnabled()) return;
  if (cfg.csat.delayMinutes > 0 && process.env.NODE_ENV !== "test") {
    await enqueue(QUEUES.email, "send-csat", { id: survey.id }, { delay: cfg.csat.delayMinutes * 60_000 });
  } else {
    await sendCsat(survey.id);
  }
}

export async function sendCsat(surveyId: string): Promise<void> {
  const cfg = getConfig();
  const s = await db.cSATResponse.findUnique({ where: { id: surveyId }, include: { ticket: { select: { id: true, number: true, title: true, statusCategory: true } }, requester: { select: { email: true, name: true, notifyByEmail: true, isActive: true } } } });
  if (!s || s.respondedAt || !s.requester.isActive || !s.requester.notifyByEmail) return;
  // Reopened in the meantime? Don't ask yet.
  if (!["RESOLVED", "CLOSED"].includes(s.ticket.statusCategory)) return;
  const labels = csatLabels(cfg.csat.scale);
  const links = labels
    .map((label, i) => `<a href="${escapeHtml(appUrl(`/csat/${s.token}?rating=${i + 1}`))}" style="display:inline-block;margin:4px 6px 4px 0;padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;text-decoration:none;color:#0f172a">${escapeHtml(label)}</a>`)
    .join("");
  await queueEmail({
    kind: "csat.survey",
    to: s.requester.email,
    subject: `How did we do? [${s.ticket.number}] ${s.ticket.title}`,
    ticket: s.ticket,
    content: { heading: cfg.csat.question, bodyHtml: `<p>${links}</p>`, paragraphs: [`About your request ${s.ticket.number}: “${s.ticket.title}”. One click is enough.`] },
  });
  await db.cSATResponse.update({ where: { id: s.id }, data: { sentAt: new Date() } });
}

export const csatAnswerSchema = z.object({ rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(2000).optional() });

export async function getSurvey(token: string) {
  const s = await db.cSATResponse.findUnique({ where: { token }, include: { ticket: { select: { number: true, title: true } } } });
  if (!s) throw new NotFoundError("Survey");
  return s;
}

export async function answerSurvey(token: string, input: z.infer<typeof csatAnswerSchema>) {
  const cfg = getConfig();
  if (input.rating > cfg.csat.scale) throw new ValidationError(`Rating must be 1–${cfg.csat.scale}`);
  const s = await getSurvey(token);
  // Allow changing the answer for a week (people misclick in emails).
  if (s.respondedAt && Date.now() - s.respondedAt.getTime() > 7 * 86_400_000) throw new ValidationError("This survey is closed");
  await db.cSATResponse.update({ where: { id: s.id }, data: { rating: input.rating, comment: input.comment ?? s.comment, respondedAt: new Date() } });
  return { ok: true };
}

let registered = false;
export function registerCsatHook() {
  if (registered) return;
  registered = true;
  onTicketEvent(async (e) => {
    if (e.type === "ticket.status_changed") await scheduleCsat(e.ticketId);
  });
}
registerCsatHook();
