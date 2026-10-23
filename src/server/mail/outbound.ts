/**
 * Outbound email: record → queue → send. Every message gets a Message-ID we
 * can recognise when a reply comes back (see inbound.ts), plus a References
 * header pointing at the ticket's thread id so mail clients group them.
 */
import { getConfig } from "@/core/config/loader";
import { ValidationError } from "@/core/errors";
import { randomToken } from "../crypto";
import { db } from "../db";
import { logger } from "../logger";
import { enqueue, QUEUES } from "../queue";
import { renderEmail, type EmailContent } from "./templates";
import { getMailTransport } from "./transport";
import { emailSideEffectsEnabled } from "../side-effects";

export function senderAddress() {
  const cfg = getConfig();
  const address = (cfg.email.fromAddress ?? cfg.branding.supportEmail).toLowerCase();
  const name = cfg.email.fromName ?? cfg.branding.name;
  return { address, name, domain: address.split("@")[1]!, from: `"${name.replace(/"/g, "'")}" <${address}>` };
}

/** All addresses that belong to us (never email them, never treat them as requesters). */
export function ownAddresses(): Set<string> {
  const cfg = getConfig();
  return new Set(
    [cfg.branding.supportEmail, cfg.email.fromAddress, ...cfg.email.mailboxes.map((m) => m.address), ...cfg.teams.flatMap((t) => (t.email ? [t.email] : []))]
      .filter((x): x is string => Boolean(x))
      .map((x) => x.toLowerCase()),
  );
}

export function ticketThreadId(number: string) {
  return `<ticket-${number}@${senderAddress().domain}>`;
}

/** Parse our own Message-IDs back to a ticket number: <INC0000012.abc@domain> or <ticket-INC0000012@domain>. */
export function ticketNumberFromMessageId(id: string): string | null {
  const domain = senderAddress().domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = id.match(new RegExp(`^<?(?:ticket-)?([A-Z]{2,6}\\d{3,12})(?:\\.[\\w-]+)?@${domain}>?$`, "i"));
  return m ? m[1]!.toUpperCase() : null;
}

export type QueueEmailInput = {
  kind: string;
  to: string;
  cc?: string[];
  subject: string;
  content: EmailContent;
  ticket?: { id: string; number: string } | null;
};

const sendInline = () => process.env.NODE_ENV === "test" || process.env.EMAIL_SEND_INLINE === "true";

export async function queueEmail(input: QueueEmailInput): Promise<string | null> {
  const cfg = getConfig();
  const own = ownAddresses();
  const to = input.to.trim().toLowerCase();
  if (!to || own.has(to)) return null; // loop prevention
  const cc = [...new Set((input.cc ?? []).map((c) => c.trim().toLowerCase()))].filter((c) => c && c !== to && !own.has(c));
  const { domain } = senderAddress();
  const messageId = `<${input.ticket?.number ?? "msg"}.${randomToken(9).replace(/[^\w-]/g, "x")}@${domain}>`;

  // Thread on the most recent message in this ticket's conversation.
  let inReplyTo: string | null = null;
  if (input.ticket) {
    const last = await db.outboundEmail.findFirst({ where: { ticketId: input.ticket.id, toAddress: to }, orderBy: { createdAt: "desc" }, select: { messageId: true } });
    const lastInbound = await db.comment.findFirst({ where: { ticketId: input.ticket.id, emailMessageId: { not: null } }, orderBy: { createdAt: "desc" }, select: { emailMessageId: true } });
    inReplyTo = lastInbound?.emailMessageId ?? last?.messageId ?? ticketThreadId(input.ticket.number);
  }

  const { html, text } = renderEmail(input.content);
  const row = await db.outboundEmail.create({
    data: {
      ticketId: input.ticket?.id ?? null,
      kind: input.kind,
      toAddress: to,
      ccAddress: cc,
      subject: input.subject.slice(0, 250),
      messageId,
      inReplyTo,
      html,
      text,
      status: cfg.email.enabled && emailSideEffectsEnabled() ? "QUEUED" : "SKIPPED",
      error: !cfg.email.enabled ? "email.enabled is false in business config" : emailSideEffectsEnabled() ? null : "not sent (demo data)",
    },
  });
  if (!cfg.email.enabled || !emailSideEffectsEnabled()) return row.id;
  if (sendInline()) await sendOutbound(row.id).catch(() => undefined);
  else await enqueue(QUEUES.email, "send-email", { id: row.id });
  return row.id;
}

/** Worker job: send one queued email. Throws on failure so BullMQ retries with backoff. */
export async function sendOutbound(id: string): Promise<void> {
  const row = await db.outboundEmail.findUnique({ where: { id }, include: { ticket: { select: { number: true } } } });
  if (!row || row.status === "SENT" || row.status === "SKIPPED") return;
  const sender = senderAddress();
  const references = [row.ticket ? ticketThreadId(row.ticket.number) : null, row.inReplyTo].filter((x, i, a): x is string => Boolean(x) && a.indexOf(x) === i);
  const transport = getMailTransport();
  try {
    await transport.send({
      from: sender.from,
      replyTo: sender.address,
      to: row.toAddress,
      cc: row.ccAddress,
      subject: row.subject,
      html: row.html,
      text: row.text,
      messageId: row.messageId,
      inReplyTo: row.inReplyTo ?? undefined,
      references,
      headers: row.ticket ? { "X-DeskForge-Ticket": row.ticket.number } : undefined,
    });
    const logged = transport.name === "log";
    await db.outboundEmail.update({
      where: { id },
      data: { status: logged ? "SKIPPED" : "SENT", sentAt: logged ? null : new Date(), attempts: { increment: 1 }, error: logged ? "SMTP not configured (SMTP_HOST is empty) — logged only" : null },
    });
  } catch (err) {
    await db.outboundEmail.update({ where: { id }, data: { status: "FAILED", attempts: { increment: 1 }, error: (err as Error).message.slice(0, 1000) } });
    logger.error({ err, id, to: row.toAddress }, "email send failed");
    throw err;
  }
}

/**
 * Send right away, for messages that contain a secret (e.g. a temporary
 * password). The secret is never stored: the Email log keeps a copy rendered
 * from `storedContent`, where the secret is masked. Failures are reported to
 * the caller instead of being retried later, because nothing is kept to retry with.
 */
export async function sendSensitiveEmail(input: QueueEmailInput & { storedContent: EmailContent }): Promise<{ id: string }> {
  const cfg = getConfig();
  if (!cfg.email.enabled) throw new ValidationError("Email is turned off (email.enabled in business.config.yaml)");
  const transport = getMailTransport();
  if (transport.name === "log") throw new ValidationError("Outgoing email isn't set up (SMTP_HOST in .env), so this can't be sent");
  const to = input.to.trim().toLowerCase();
  if (!to || ownAddresses().has(to)) throw new ValidationError("Can't send this to the help desk's own address");
  const sender = senderAddress();
  const messageId = `<msg.${randomToken(9).replace(/[^\w-]/g, "x")}@${sender.domain}>`;
  const stored = renderEmail(input.storedContent);
  const row = await db.outboundEmail.create({
    data: { kind: input.kind, toAddress: to, ccAddress: [], subject: input.subject.slice(0, 250), messageId, html: stored.html, text: stored.text, status: "QUEUED" },
  });
  if (!emailSideEffectsEnabled()) {
    await db.outboundEmail.update({ where: { id: row.id }, data: { status: "SKIPPED", error: "not sent (demo data)" } });
    return { id: row.id };
  }
  const { html, text } = renderEmail(input.content);
  try {
    await transport.send({ from: sender.from, replyTo: sender.address, to, subject: input.subject, html, text, messageId });
  } catch (err) {
    const message = (err as Error).message.slice(0, 1000);
    await db.outboundEmail.update({ where: { id: row.id }, data: { status: "FAILED", attempts: 1, error: message } });
    logger.warn({ id: row.id, kind: input.kind, err: message }, "sensitive email failed");
    throw new ValidationError(`The email couldn't be sent: ${message}`);
  }
  await db.outboundEmail.update({ where: { id: row.id }, data: { status: "SENT", sentAt: new Date(), attempts: 1 } });
  return { id: row.id };
}
