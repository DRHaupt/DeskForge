/**
 * Mail transport. SMTP when SMTP_HOST is set; otherwise emails are logged (dev)
 * or kept in memory (tests) so the rest of the pipeline still runs.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { getEnv } from "../env";
import { logger } from "../logger";

export type OutgoingMessage = {
  from: string;
  to: string;
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  replyTo?: string;
  headers?: Record<string, string>;
};

export interface MailTransport {
  readonly name: string;
  send(msg: OutgoingMessage): Promise<void>;
}

class SmtpTransport implements MailTransport {
  readonly name = "smtp";
  private readonly t: Transporter;
  constructor() {
    const env = getEnv();
    this.t = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }
  async send(msg: OutgoingMessage) {
    await this.t.sendMail({
      from: msg.from,
      to: msg.to,
      cc: msg.cc?.length ? msg.cc : undefined,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      messageId: msg.messageId,
      inReplyTo: msg.inReplyTo,
      references: msg.references,
      replyTo: msg.replyTo,
      headers: { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All", ...msg.headers },
    });
  }
}

/** Logs instead of sending (no SMTP configured). */
class LogTransport implements MailTransport {
  readonly name = "log";
  async send(msg: OutgoingMessage) {
    logger.info({ to: msg.to, cc: msg.cc, subject: msg.subject, messageId: msg.messageId }, "email (SMTP not configured — not sent)");
  }
}

/** Captures messages in memory (tests). */
export class MemoryTransport implements MailTransport {
  readonly name = "memory";
  readonly sent: OutgoingMessage[] = [];
  async send(msg: OutgoingMessage) {
    this.sent.push(msg);
  }
}

let transport: MailTransport | undefined;

export function getMailTransport(): MailTransport {
  if (transport) return transport;
  const env = getEnv();
  transport = env.SMTP_HOST ? new SmtpTransport() : env.NODE_ENV === "test" ? new MemoryTransport() : new LogTransport();
  return transport;
}

export function setMailTransport(t: MailTransport | undefined) {
  transport = t;
}
