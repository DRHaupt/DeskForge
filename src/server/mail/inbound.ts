/**
 * Inbound email → ticket or comment.
 *
 * Threading order: our own Message-IDs in In-Reply-To/References → Message-IDs
 * of earlier inbound mails on a ticket → a ticket number in the subject.
 * Replies are only appended when the sender is allowed on that ticket
 * (requester, watcher, or staff who can see it); otherwise a new ticket is
 * opened, so knowing a ticket number isn't enough to post into it.
 */
import { createHash } from "node:crypto";
import { simpleParser, type AddressObject } from "mailparser";
import { getConfig } from "@/core/config/loader";
import { activeTicketTypes } from "@/core/config/helpers";
import { canViewTicket, canSeeInternal } from "@/core/tickets/access";
import { findTicketNumbers } from "@/core/tickets/numbering";
import { isAgent, systemActor } from "@/core/rbac/actor";
import { CommentSource, InboundEmailStatus } from "@/generated/prisma/enums";
import { loadUserActor } from "../actor";
import { db } from "../db";
import { logger } from "../logger";
import { plainTextToHtml, sanitizeRichText } from "../richtext";
import { storeAttachment } from "../services/attachments";
import { addComment, createTicket } from "../services/tickets";
import { normalizeEmail, provisionUser } from "../users";
import { ownAddresses, ticketNumberFromMessageId } from "./outbound";
import { REPLY_MARKER } from "./templates";

export type InboundAttachment = { filename: string; contentType: string; content: Buffer };

export type InboundMessage = {
  messageId: string;
  from: { address: string; name: string };
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string | null;
  inReplyTo: string | null;
  references: string[];
  headers: Record<string, string>;
  attachments: InboundAttachment[];
};

export type InboundResult = { status: InboundEmailStatus; ticketId?: string; ticketNumber?: string; commentId?: string; reason?: string };

function addresses(a: AddressObject | AddressObject[] | undefined): { address: string; name: string }[] {
  if (!a) return [];
  const list = Array.isArray(a) ? a : [a];
  return list.flatMap((x) => x.value.flatMap((v) => (v.address ? [{ address: v.address.toLowerCase(), name: v.name ?? "" }] : [])));
}

export async function parseRawEmail(raw: Buffer | string): Promise<InboundMessage> {
  const m = await simpleParser(raw, { skipImageLinks: true });
  const headers: Record<string, string> = {};
  for (const [k, v] of m.headers) headers[k.toLowerCase()] = typeof v === "string" ? v : JSON.stringify(v);
  const from = addresses(m.from)[0] ?? { address: "", name: "" };
  const refs = Array.isArray(m.references) ? m.references : m.references ? [m.references] : [];
  return {
    messageId: m.messageId ?? "",
    from,
    to: addresses(m.to).map((a) => a.address),
    cc: addresses(m.cc).map((a) => a.address),
    subject: m.subject ?? "(no subject)",
    text: m.text ?? "",
    html: typeof m.html === "string" ? m.html : null,
    inReplyTo: m.inReplyTo ?? null,
    references: refs,
    headers,
    attachments: m.attachments
      .filter((a) => a.contentDisposition !== "inline" || !a.contentId)
      .map((a) => ({ filename: a.filename ?? "attachment", contentType: a.contentType, content: a.content })),
  };
}

/** Auto-replies, bounces and bulk mail should never create tickets (prevents mail loops). */
export function isAutomated(msg: InboundMessage): string | null {
  const h = msg.headers;
  const auto = h["auto-submitted"];
  if (auto && auto.toLowerCase() !== "no") return "auto-submitted";
  if (h["x-autoreply"] || h["x-autorespond"] || h["x-auto-response-suppress"]?.toLowerCase().includes("all")) return "auto-reply";
  const prec = h["precedence"]?.toLowerCase();
  if (prec && ["bulk", "junk", "list", "auto_reply"].includes(prec)) return `precedence ${prec}`;
  if (h["x-deskforge-ticket"]) return "our own outbound message";
  return null;
}

function wildcardMatch(pattern: string, value: string) {
  const re = new RegExp(`^${pattern.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return re.test(value.toLowerCase());
}

/** Remove quoted history from a reply so only the new text becomes the comment. */
export function stripQuotedReply(text: string): string {
  let t = text.replace(/\r\n/g, "\n");
  const marker = t.indexOf(REPLY_MARKER);
  if (marker !== -1) t = t.slice(0, marker);
  const lines = t.split("\n");
  const cut = lines.findIndex(
    (l, i) =>
      /^On .{3,200}wrote:\s*$/i.test(l.trim()) ||
      (/^On .{3,200}$/i.test(l.trim()) && /wrote:\s*$/i.test(lines[i + 1]?.trim() ?? "")) ||
      /^-{2,}\s*Original Message\s*-{2,}/i.test(l.trim()) ||
      /^_{5,}$/.test(l.trim()) ||
      (/^From:\s/i.test(l.trim()) && lines.slice(i + 1, i + 5).some((x) => /^(Sent|Date):\s/i.test(x.trim()))),
  );
  const kept = (cut === -1 ? lines : lines.slice(0, cut)).filter((l) => !/^>/.test(l));
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanSubject(s: string) {
  return s.replace(/^\s*((re|fw|fwd|aw|sv|wg)\s*:\s*)+/i, "").replace(/\[[A-Z]{2,6}\d{3,12}\]\s*/g, "").trim() || "(no subject)";
}

async function findThreadTicket(msg: InboundMessage): Promise<{ id: string; number: string } | null> {
  const ids = [msg.inReplyTo, ...msg.references].filter((x): x is string => Boolean(x));
  if (ids.length) {
    const out = await db.outboundEmail.findFirst({ where: { messageId: { in: ids }, ticketId: { not: null } }, select: { ticket: { select: { id: true, number: true } } } });
    if (out?.ticket) return out.ticket;
    for (const id of ids) {
      const n = ticketNumberFromMessageId(id);
      if (n) {
        const t = await db.ticket.findUnique({ where: { number: n }, select: { id: true, number: true } });
        if (t) return t;
      }
    }
    const c = await db.comment.findFirst({ where: { emailMessageId: { in: ids } }, select: { ticket: { select: { id: true, number: true } } } });
    if (c) return c.ticket;
    const t = await db.ticket.findFirst({ where: { emailMessageId: { in: ids } }, select: { id: true, number: true } });
    if (t) return t;
  }
  const prefixes = activeTicketTypes(getConfig()).map((t) => t.prefix);
  for (const n of findTicketNumbers(msg.subject, prefixes)) {
    const t = await db.ticket.findUnique({ where: { number: n }, select: { id: true, number: true } });
    if (t) return t;
  }
  return null;
}

async function storeAll(attachments: InboundAttachment[], uploaderId: string | null) {
  const ids: string[] = [];
  for (const a of attachments.slice(0, 20)) {
    try {
      const att = await storeAttachment(null, { name: a.filename, type: a.contentType, data: a.content });
      if (uploaderId) await db.attachment.update({ where: { id: att.id }, data: { uploaderId } });
      ids.push(att.id);
    } catch (err) {
      logger.warn({ err: (err as Error).message, filename: a.filename }, "inbound attachment rejected");
    }
  }
  return ids;
}

export async function processInbound(msg: InboundMessage, opts: { mailbox?: string } = {}): Promise<InboundResult> {
  const cfg = getConfig();
  const own = ownAddresses();
  const recipients = [...msg.to, ...msg.cc, ...(msg.headers["delivered-to"] ? [msg.headers["delivered-to"].toLowerCase()] : [])];
  const mailbox =
    cfg.email.mailboxes.find((m) => m.address.toLowerCase() === opts.mailbox?.toLowerCase()) ??
    cfg.email.mailboxes.find((m) => recipients.includes(m.address.toLowerCase())) ??
    cfg.email.mailboxes[0];
  const sender = normalizeEmail(msg.from.address || "");
  const messageId = msg.messageId || `<generated.${createHash("sha256").update(`${sender}|${msg.subject}|${msg.text}`).digest("hex").slice(0, 24)}@deskforge.invalid>`;

  const record = async (status: InboundEmailStatus, extra: { ticketId?: string | null; error?: string } = {}) => {
    await db.inboundEmail.upsert({
      where: { messageId },
      create: { messageId, mailbox: mailbox?.address ?? opts.mailbox ?? "unknown", fromEmail: sender || "unknown", subject: msg.subject.slice(0, 500), status, ticketId: extra.ticketId ?? null, error: extra.error },
      update: { status, ticketId: extra.ticketId ?? null, error: extra.error },
    });
  };

  if (!cfg.email.enabled) return { status: "IGNORED", reason: "email disabled in config" };
  if (await db.inboundEmail.findUnique({ where: { messageId } })) return { status: "IGNORED", reason: "duplicate" };
  if (!sender || !sender.includes("@")) {
    await record("IGNORED", { error: "no sender" });
    return { status: "IGNORED", reason: "no sender" };
  }
  if (own.has(sender)) {
    await record("IGNORED", { error: "sent from our own address" });
    return { status: "IGNORED", reason: "loop" };
  }
  const automated = isAutomated(msg);
  if (automated) {
    await record("IGNORED", { error: automated });
    return { status: "IGNORED", reason: automated };
  }
  if (cfg.email.ignoreSenders.some((p) => wildcardMatch(p, sender))) {
    await record("IGNORED", { error: "sender on ignore list" });
    return { status: "IGNORED", reason: "ignored sender" };
  }

  try {
    let user = await db.user.findUnique({ where: { email: sender } });
    const thread = await findThreadTicket(msg);

    // ── Reply to an existing ticket ─────────────────────────────────────
    if (thread) {
      const ticket = await db.ticket.findUniqueOrThrow({ where: { id: thread.id }, include: { watchers: true } });
      const watcherEmail = ticket.watchers.some((w) => w.email === sender);
      if (!user && watcherEmail && cfg.email.createUnknownSenders) {
        user = await provisionUser({ email: sender, name: msg.from.name || sender, roleKeys: ["requester"] });
        await db.ticketWatcher.updateMany({ where: { ticketId: ticket.id, email: sender }, data: { userId: user.id, email: null } });
      }
      const actor = user ? await loadUserActor(db, user.id) : null;
      const allowed =
        actor &&
        canViewTicket(actor, { requesterId: ticket.requesterId, organizationId: ticket.organizationId, teamId: ticket.teamId, assigneeId: ticket.assigneeId, watcherUserIds: [...ticket.watchers.flatMap((w) => (w.userId ? [w.userId] : [])), ...(watcherEmail && user ? [user.id] : [])] });
      if (actor && allowed) {
        const body = stripQuotedReply(msg.text || "") || "(empty reply)";
        const attachmentIds = await storeAll(msg.attachments, actor.id);
        const staff = isAgent(actor) && canSeeInternal(actor);
        const comment = await addComment(actor, ticket.id, { body: plainTextToHtml(body), visibility: "PUBLIC", attachmentIds }, { source: CommentSource.EMAIL, emailMessageId: messageId });
        await record("APPENDED_COMMENT", { ticketId: ticket.id });
        logger.info({ ticket: ticket.number, from: sender, staff }, "inbound email appended");
        return { status: "APPENDED_COMMENT", ticketId: ticket.id, ticketNumber: ticket.number, commentId: comment.id };
      }
      // Not allowed on that ticket: fall through and open a new one.
    }

    // ── New ticket ─────────────────────────────────────────────────────
    if (!mailbox) {
      await record("IGNORED", { error: "no mailbox configured" });
      return { status: "IGNORED", reason: "no mailbox" };
    }
    if (!user) {
      if (!cfg.email.createUnknownSenders) {
        await record("IGNORED", { error: "unknown sender" });
        return { status: "IGNORED", reason: "unknown sender" };
      }
      user = await provisionUser({ email: sender, name: msg.from.name || sender, roleKeys: ["requester"] });
    }
    if (!user.isActive) {
      await record("IGNORED", { error: "sender account deactivated" });
      return { status: "IGNORED", reason: "inactive sender" };
    }
    const team = mailbox.team ? await db.team.findUnique({ where: { key: mailbox.team }, select: { id: true } }) : null;
    const description = msg.html ? sanitizeRichText(msg.html) : plainTextToHtml(msg.text || "");
    const attachmentIds = await storeAll(msg.attachments, null);
    const typeCfg = activeTicketTypes(cfg).find((t) => t.key === mailbox.ticketType);
    // Email can't fill required custom fields; skip validation by creating with empty values where allowed.
    const fields: Record<string, unknown> = {};
    for (const f of typeCfg?.fields ?? []) if (f.required) fields[f.key] = f.type === "number" ? (f.min ?? 0) : f.type === "dropdown" || f.type === "multiselect" ? (f.type === "dropdown" ? f.options![0]!.value : [f.options![0]!.value]) : f.type === "date" ? new Date().toISOString().slice(0, 10) : f.type === "checkbox" ? false : "(via email)";
    const created = await createTicket(
      systemActor("email"),
      {
        type: mailbox.ticketType,
        title: cleanSubject(msg.subject).slice(0, 200).padEnd(3, "."),
        description,
        requesterId: user.id,
        teamId: team?.id,
        fields,
        ccEmails: msg.cc.filter((c) => !own.has(c) && c !== sender).slice(0, 20),
        attachmentIds,
      },
      { source: "EMAIL", emailMessageId: messageId },
    );
    await record("CREATED_TICKET", { ticketId: created.id });
    logger.info({ ticket: created.number, from: sender, mailbox: mailbox.address }, "inbound email created ticket");
    return { status: "CREATED_TICKET", ticketId: created.id, ticketNumber: created.number };
  } catch (err) {
    logger.error({ err, messageId }, "inbound email failed");
    await record("FAILED", { error: (err as Error).message.slice(0, 1000) });
    return { status: "FAILED", reason: (err as Error).message };
  }
}
