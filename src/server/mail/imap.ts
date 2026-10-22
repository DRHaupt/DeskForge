/**
 * IMAP polling for mailboxes with mode "imap". Credentials come from env vars
 * named by `imapEnvPrefix` (e.g. IMAP_HELP_HOST, _PORT, _USER, _PASSWORD, _TLS).
 * Unseen messages are processed and then flagged \Seen.
 */
import { ImapFlow } from "imapflow";
import { getConfig } from "@/core/config/loader";
import { envValue } from "../env";
import { logger } from "../logger";
import { parseRawEmail, processInbound } from "./inbound";

const lastPoll = new Map<string, number>();

export async function pollMailboxes(now = Date.now()): Promise<{ mailbox: string; processed: number }[]> {
  const cfg = getConfig();
  if (!cfg.email.enabled) return [];
  const results: { mailbox: string; processed: number }[] = [];
  for (const mb of cfg.email.mailboxes.filter((m) => m.mode === "imap" && m.imapEnvPrefix)) {
    if (now - (lastPoll.get(mb.address) ?? 0) < mb.pollSeconds * 1000) continue;
    lastPoll.set(mb.address, now);
    const prefix = mb.imapEnvPrefix!;
    const host = envValue(prefix, "HOST");
    const user = envValue(prefix, "USER");
    const pass = envValue(prefix, "PASSWORD");
    if (!host || !user || !pass) {
      logger.debug({ mailbox: mb.address }, "IMAP credentials not set; skipping");
      continue;
    }
    const client = new ImapFlow({
      host,
      port: Number(envValue(prefix, "PORT") ?? 993),
      secure: (envValue(prefix, "TLS") ?? "true") !== "false",
      auth: { user, pass },
      logger: false,
    });
    let processed = 0;
    try {
      await client.connect();
      const lock = await client.getMailboxLock(envValue(prefix, "FOLDER") ?? "INBOX");
      try {
        const uids = (await client.search({ seen: false }, { uid: true })) || [];
        for (const uid of uids.slice(0, 50)) {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const parsed = await parseRawEmail(msg.source);
          await processInbound(parsed, { mailbox: mb.address });
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
          processed++;
        }
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (err) {
      logger.error({ err: (err as Error).message, mailbox: mb.address }, "IMAP poll failed");
      await client.close();
    }
    results.push({ mailbox: mb.address, processed });
  }
  return results;
}
