/**
 * Inbound email webhook for providers that POST parsed or raw mail
 * (Mailgun, Postmark, SendGrid Inbound Parse, Cloudflare Email Workers…).
 *
 * Authenticate with ?secret=INBOUND_EMAIL_SECRET or HTTP Basic auth whose
 * password is the secret. Accepted bodies:
 *   - message/rfc822 (raw MIME)
 *   - multipart/form-data with a raw MIME field: "body-mime" (Mailgun), "email" (SendGrid), or "raw"
 *   - JSON: { "raw": "<MIME>" } or a Postmark-style object (From, To, Subject, TextBody, HtmlBody, MessageID, Headers, Attachments)
 * Optional ?mailbox=address picks the mailbox when the recipient can't be inferred.
 */
import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { rateLimit } from "@/server/rate-limit";
import { parseRawEmail, processInbound, type InboundMessage } from "@/server/mail/inbound";

export const dynamic = "force-dynamic";

function secretOk(req: NextRequest): boolean {
  const secret = getEnv().INBOUND_EMAIL_SECRET;
  if (!secret) return false;
  const candidates = [req.nextUrl.searchParams.get("secret")];
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) candidates.push(Buffer.from(auth.slice(6), "base64").toString().split(":").slice(1).join(":"));
  return candidates.some((c) => c && c.length === secret.length && timingSafeEqual(Buffer.from(c), Buffer.from(secret)));
}

type PostmarkLike = {
  From?: string;
  FromFull?: { Email: string; Name?: string };
  FromName?: string;
  To?: string;
  ToFull?: { Email: string }[];
  Cc?: string;
  CcFull?: { Email: string }[];
  Subject?: string;
  TextBody?: string;
  HtmlBody?: string;
  StrippedTextReply?: string;
  MessageID?: string;
  Headers?: { Name: string; Value: string }[];
  Attachments?: { Name: string; Content: string; ContentType: string }[];
};

function fromPostmark(j: PostmarkLike): InboundMessage {
  const headers = Object.fromEntries((j.Headers ?? []).map((h) => [h.Name.toLowerCase(), h.Value]));
  const split = (s?: string) => (s ?? "").split(",").map((x) => x.replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase()).filter(Boolean);
  const msgId = headers["message-id"] ?? (j.MessageID ? `<${j.MessageID}@postmark>` : "");
  return {
    messageId: msgId,
    from: { address: (j.FromFull?.Email ?? split(j.From)[0] ?? "").toLowerCase(), name: j.FromFull?.Name ?? j.FromName ?? "" },
    to: j.ToFull?.map((t) => t.Email.toLowerCase()) ?? split(j.To),
    cc: j.CcFull?.map((t) => t.Email.toLowerCase()) ?? split(j.Cc),
    subject: j.Subject ?? "(no subject)",
    text: j.TextBody ?? "",
    html: j.HtmlBody ?? null,
    inReplyTo: headers["in-reply-to"] ?? null,
    references: (headers["references"] ?? "").split(/\s+/).filter(Boolean),
    headers,
    attachments: (j.Attachments ?? []).map((a) => ({ filename: a.Name, contentType: a.ContentType, content: Buffer.from(a.Content, "base64") })),
  };
}

export async function POST(req: NextRequest) {
  if (!secretOk(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await rateLimit(`inbound-email:${ip}`, 600)).allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > 40 * 1024 * 1024) return NextResponse.json({ error: "Message too large" }, { status: 413 });

  const type = req.headers.get("content-type") ?? "";
  let msg: InboundMessage;
  try {
    if (type.includes("message/rfc822") || type.includes("text/plain")) {
      msg = await parseRawEmail(Buffer.from(await req.arrayBuffer()));
    } else if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      const raw = form.get("body-mime") ?? form.get("email") ?? form.get("raw");
      if (!raw) return NextResponse.json({ error: "No raw MIME field (body-mime, email or raw) in form" }, { status: 400 });
      msg = await parseRawEmail(typeof raw === "string" ? raw : Buffer.from(await raw.arrayBuffer()));
    } else if (type.includes("application/json")) {
      const json = (await req.json()) as { raw?: string } & PostmarkLike;
      msg = json.raw ? await parseRawEmail(json.raw) : fromPostmark(json);
    } else {
      return NextResponse.json({ error: `Unsupported content type ${type}` }, { status: 415 });
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "inbound webhook: unparseable message");
    return NextResponse.json({ error: "Could not parse message" }, { status: 400 });
  }
  const result = await processInbound(msg, { mailbox: req.nextUrl.searchParams.get("mailbox") ?? undefined });
  // Always 200 for handled/ignored mail so providers don't retry forever; 500 only on our failures.
  return NextResponse.json(result, { status: result.status === "FAILED" ? 500 : 200 });
}
