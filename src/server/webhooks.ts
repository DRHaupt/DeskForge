/**
 * Outgoing webhooks: signed JSON POSTs for ticket events, delivered by the
 * worker with retries and exponential backoff.
 *
 * Signature header (verify on the receiving side):
 *   X-DeskForge-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 * Reject requests whose timestamp is more than 5 minutes old.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { z } from "zod";
import { assertCan, type Actor } from "@/core/rbac/actor";
import { NotFoundError, ValidationError } from "@/core/errors";
import { audit, type AuditContext } from "./audit";
import { randomToken } from "./crypto";
import { db } from "./db";
import { getEnv } from "./env";
import { TICKET_EVENTS, type TicketEvent } from "./events";
import { logger } from "./logger";
import { enqueue, QUEUES } from "./queue";
import { appUrl } from "./mail/templates";

export const WEBHOOK_EVENTS = [...TICKET_EVENTS, "webhook.test"] as const;
const MAX_ATTEMPTS = 8;

export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Reference verifier (also used in tests and documented for receivers). */
export function verifySignature(secret: string, header: string, body: string, now = Date.now(), toleranceSec = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1 || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = Buffer.from(signPayload(secret, t, body));
  const got = Buffer.from(parts.v1);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

// ─── SSRF protection ───────────────────────────────────────────────────────

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError("Invalid URL");
  }
  if (!["https:", "http:"].includes(url.protocol)) throw new ValidationError("Webhook URLs must use http or https");
  if (url.username || url.password) throw new ValidationError("Put credentials in headers, not the URL");
  const allowPrivate = getEnv().WEBHOOK_ALLOW_PRIVATE;
  if (getEnv().NODE_ENV === "production" && url.protocol !== "https:" && !allowPrivate) throw new ValidationError("Webhook URLs must use https");
  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (!addrs.length) throw new ValidationError(`Can't resolve ${host}`);
    if (addrs.some(isPrivateIp)) throw new ValidationError("Webhook URL points at a private or internal address (set WEBHOOK_ALLOW_PRIVATE=true to allow)");
  }
  return url;
}

// ─── Management ────────────────────────────────────────────────────────────

export const webhookSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.url().max(2000),
  events: z.array(z.enum([...WEBHOOK_EVENTS, "*"] as [string, ...string[]])).min(1).max(30),
  isActive: z.boolean().default(true),
});

export async function listWebhooks(actor: Actor) {
  assertCan(actor, "webhook.manage");
  const hooks = await db.webhook.findMany({ orderBy: { name: "asc" }, include: { deliveries: { orderBy: { createdAt: "desc" }, take: 10 } } });
  return hooks.map(({ secret, ...h }) => ({ ...h, secretPreview: `${secret.slice(0, 6)}…` }));
}

export async function createWebhook(actor: Actor, input: z.infer<typeof webhookSchema>, ctx?: AuditContext) {
  assertCan(actor, "webhook.manage");
  await assertSafeUrl(input.url);
  const secret = `whsec_${randomToken(24)}`;
  const hook = await db.webhook.create({ data: { ...input, secret } });
  await audit(actor, { action: "webhook.create", entityType: "webhook", entityId: hook.id, changes: { name: input.name, url: input.url, events: input.events } }, ctx);
  // The secret is shown once, here.
  return { id: hook.id, secret };
}

export async function updateWebhook(actor: Actor, id: string, input: Partial<z.infer<typeof webhookSchema>> & { rotateSecret?: boolean }, ctx?: AuditContext) {
  assertCan(actor, "webhook.manage");
  if (input.url) await assertSafeUrl(input.url);
  const { rotateSecret, ...rest } = input;
  const secret = rotateSecret ? `whsec_${randomToken(24)}` : undefined;
  await db.webhook.update({ where: { id }, data: { ...rest, ...(secret ? { secret } : {}) } });
  await audit(actor, { action: "webhook.update", entityType: "webhook", entityId: id, changes: { ...rest, rotateSecret: Boolean(rotateSecret) } }, ctx);
  return { id, ...(secret ? { secret } : {}) };
}

export async function deleteWebhook(actor: Actor, id: string, ctx?: AuditContext) {
  assertCan(actor, "webhook.manage");
  await db.webhook.delete({ where: { id } });
  await audit(actor, { action: "webhook.delete", entityType: "webhook", entityId: id }, ctx);
  return { id };
}

// ─── Payloads & delivery ───────────────────────────────────────────────────

async function ticketSummary(ticketId: string) {
  const t = await db.ticket.findUnique({
    where: { id: ticketId },
    include: { type: { select: { key: true } }, team: { select: { key: true, name: true } }, assignee: { select: { name: true, email: true } }, requester: { select: { name: true, email: true } }, organization: { select: { slug: true, name: true } } },
  });
  if (!t) return null;
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    type: t.type.key,
    status: t.status,
    statusCategory: t.statusCategory,
    priority: t.priority,
    source: t.source,
    team: t.team,
    assignee: t.assignee,
    requester: t.requester,
    organization: t.organization,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    url: appUrl(`/agent/tickets/${t.number}`),
  };
}

export async function queueDelivery(webhookId: string, event: string, data: Record<string, unknown>) {
  const delivery = await db.webhookDelivery.create({ data: { webhookId, event, payload: {} } });
  const payload = { ...data, id: delivery.id, event, occurredAt: new Date().toISOString() };
  await db.webhookDelivery.update({ where: { id: delivery.id }, data: { payload: payload as object } });
  if (process.env.NODE_ENV === "test" || process.env.WEBHOOK_SEND_INLINE === "true") {
    await deliverWebhook(delivery.id).catch(() => undefined);
  } else {
    await enqueue(QUEUES.webhooks, "deliver-webhook", { id: delivery.id }, { attempts: MAX_ATTEMPTS, backoff: { type: "exponential", delay: 30_000 } });
  }
  return delivery.id;
}

/** Fan a ticket event out to every subscribed webhook (worker). */
export async function fanOutWebhooks(event: TicketEvent, onlyWebhookId?: string) {
  const hooks = await db.webhook.findMany({
    where: onlyWebhookId ? { id: onlyWebhookId, isActive: true } : { isActive: true, OR: [{ events: { has: event.type } }, { events: { has: "*" } }] },
    select: { id: true },
  });
  if (!hooks.length) return 0;
  const ticket = await ticketSummary(event.ticketId);
  for (const h of hooks) await queueDelivery(h.id, event.type, { ticket, changes: event.changes ?? null, actor: event.actor });
  return hooks.length;
}

/** Worker job. Throws on failure so BullMQ retries with backoff. */
export async function deliverWebhook(deliveryId: string): Promise<void> {
  const d = await db.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { webhook: true } });
  if (!d || d.status === "SUCCEEDED") return;
  if (!d.webhook.isActive) {
    await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "FAILED", error: "webhook disabled" } });
    return;
  }
  const body = JSON.stringify(d.payload);
  const t = Math.floor(Date.now() / 1000);
  const attempt = d.attempts + 1;
  try {
    const url = await assertSafeUrl(d.webhook.url);
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json",
        "user-agent": "DeskForge-Webhooks/1",
        "x-deskforge-event": d.event,
        "x-deskforge-delivery": d.id,
        "x-deskforge-timestamp": String(t),
        "x-deskforge-signature": `t=${t},v1=${signPayload(d.webhook.secret, t, body)}`,
      },
      body,
    });
    const text = (await res.text().catch(() => "")).slice(0, 2000);
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, text });
    await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "SUCCEEDED", attempts: attempt, responseStatus: res.status, responseBody: text, error: null, deliveredAt: new Date(), nextAttemptAt: null } });
    await db.webhook.update({ where: { id: d.webhookId }, data: { lastDeliveryAt: new Date() } });
  } catch (err) {
    const e = err as Error & { status?: number; text?: string };
    const final = attempt >= MAX_ATTEMPTS;
    await db.webhookDelivery.update({
      where: { id: d.id },
      data: {
        status: final ? "FAILED" : "PENDING",
        attempts: attempt,
        responseStatus: e.status ?? null,
        responseBody: e.text ?? null,
        error: e.message.slice(0, 1000),
        nextAttemptAt: final ? null : new Date(Date.now() + 30_000 * 2 ** (attempt - 1)),
      },
    });
    logger.warn({ webhook: d.webhookId, delivery: d.id, attempt, err: e.message }, "webhook delivery failed");
    if (!final) throw err;
  }
}

export async function sendTestWebhook(actor: Actor, id: string) {
  assertCan(actor, "webhook.manage");
  const hook = await db.webhook.findUnique({ where: { id } });
  if (!hook) throw new NotFoundError("Webhook");
  const deliveryId = await queueDelivery(id, "webhook.test", { message: "This is a test delivery from DeskForge." });
  return { deliveryId };
}

export async function redeliver(actor: Actor, deliveryId: string) {
  assertCan(actor, "webhook.manage");
  const d = await db.webhookDelivery.findUnique({ where: { id: deliveryId } });
  if (!d) throw new NotFoundError("Delivery");
  return { deliveryId: await queueDelivery(d.webhookId, d.event, d.payload as Record<string, unknown>) };
}
