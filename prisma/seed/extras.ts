/** Demo KB articles, catalog requests, CSAT responses and more, adapted to the business config. */
import type { BusinessConfig } from "../../src/core/config/schema";
import type { Db } from "../../src/server/db";
import { loadUserActor } from "../../src/server/actor";
import { createArticle } from "../../src/server/services/kb";
import { submitCatalogRequest } from "../../src/server/services/catalog";
import { randomToken } from "../../src/server/crypto";
import { seedItsm } from "./itsm";
import { seedAutomation } from "./automation";

type Art = { title: string; category: string; tags: string[]; body: string; visibility?: "PUBLIC" | "INTERNAL"; views: number };

const IT_ARTICLES: Art[] = [
  {
    title: "Connect to the VPN from home",
    category: "Remote work",
    tags: ["vpn", "remote"],
    views: 412,
    body: `<p>The VPN gives you secure access to shared drives and internal apps from anywhere.</p><h2>Before you start</h2><ul><li>Make sure your laptop has the VPN client installed (look for it in the Start menu).</li><li>Sign in once while on the office network so your certificate is downloaded.</li></ul><h2>Connect</h2><ol><li>Open the VPN client.</li><li>Choose <strong>Office</strong> as the connection.</li><li>Sign in with your normal email and password, then approve the sign-in on your phone.</li></ol><h2>If it says "authentication failed"</h2><p>Sign out of the client completely, restart it and try again. If it still fails your certificate may be missing — open a ticket and mention the exact error.</p>`,
  },
  {
    title: "Reset your password",
    category: "Accounts & access",
    tags: ["password", "account"],
    views: 655,
    body: `<p>You can reset your password yourself — no ticket needed.</p><ol><li>Go to the sign-in page and click <strong>Forgot your password?</strong></li><li>Enter your work email. We'll send a link that works for one hour.</li><li>Choose a new password that meets the rules shown on the page.</li></ol><p>If you don't get the email within five minutes, check your junk folder, then contact us.</p>`,
  },
  {
    title: "Set up email on your phone",
    category: "Email & calendar",
    tags: ["email", "mobile", "outlook"],
    views: 288,
    body: `<p>Use the official Outlook app on iPhone or Android — it supports our security settings and sets itself up automatically.</p><ol><li>Install <strong>Microsoft Outlook</strong> from the App Store or Google Play.</li><li>Open it and enter your work email address.</li><li>Sign in and approve the request on your phone.</li></ol><p>The built-in Mail app isn't supported because it can't enforce device security.</p>`,
  },
  {
    title: "Printer jams or prints blank pages",
    category: "Hardware",
    tags: ["printer"],
    views: 173,
    body: `<p>Most printer problems can be fixed in two minutes.</p><ul><li><strong>Paper jam:</strong> open every door the display mentions, gently pull paper in the direction it travels, close the doors firmly.</li><li><strong>Blank pages:</strong> remove the toner cartridge, shake it side to side five times, reinsert it.</li><li><strong>Nothing prints:</strong> check the printer shows <em>Ready</em>, then delete stuck jobs from <em>Settings → Printers</em> on your computer.</li></ul><p>Still stuck? Open a ticket with the printer's name and the message on its display.</p>`,
  },
  {
    title: "Your laptop battery drains quickly",
    category: "Hardware",
    tags: ["battery", "laptop"],
    views: 98,
    body: `<p>Batteries wear out over time. Here's how to check yours.</p><ol><li>Unplug the charger and note the battery percentage.</li><li>Lower screen brightness and close apps you don't need.</li><li>If it still drops more than 20% an hour with light use, the battery probably needs replacing — open a ticket and include your laptop's asset tag.</li></ol>`,
  },
  {
    title: "Request access to a shared drive",
    category: "Accounts & access",
    tags: ["access", "shared drive"],
    views: 140,
    body: `<p>Use the service catalog item <strong>Shared drive access</strong> (or <strong>Request something</strong> in the portal). Tell us the folder name and whether you need view or edit access. Your manager may be asked to approve it.</p>`,
  },
  {
    title: "Recognise and report phishing emails",
    category: "Security",
    tags: ["security", "phishing", "email"],
    views: 230,
    body: `<p>Phishing emails try to trick you into giving away passwords or opening malware.</p><h2>Warning signs</h2><ul><li>Urgent requests to "verify your account" or pay an invoice.</li><li>A sender name that looks right but an address that doesn't.</li><li>Links whose real address (hover to see it) doesn't match the text.</li></ul><h2>What to do</h2><p>Don't click. Forward the email to the help desk as an attachment, then delete it. If you already clicked a link or entered your password, tell us immediately — speed matters.</p>`,
  },
  {
    title: "Escalation runbook: internet outage",
    category: "Remote work",
    tags: ["network", "outage", "runbook"],
    visibility: "INTERNAL",
    views: 37,
    body: `<p><strong>Internal — agents only.</strong></p><ol><li>Check the firewall dashboard for WAN status.</li><li>If WAN is down, confirm 4G failover kicked in and post a status update.</li><li>Call the ISP NOC with the circuit ID from the network sheet.</li><li>Raise a P1 incident and link all user reports to it as children.</li></ol>`,
  },
];

const STORE_ARTICLES: Art[] = [
  { title: "Where is my order?", category: "Orders & delivery", tags: ["delivery", "tracking"], views: 1290, body: `<p>You'll get a tracking link by email as soon as your order leaves our warehouse — usually within one working day.</p><ul><li><strong>UK standard:</strong> 2–4 working days.</li><li><strong>UK express:</strong> next working day if ordered before 2pm.</li><li><strong>Ireland & EU:</strong> 3–7 working days.</li></ul><p>If tracking hasn't moved for 3 working days, contact us with your order number (it starts with FL-) and we'll chase the courier.</p>` },
  { title: "How to return an item", category: "Returns & refunds", tags: ["returns"], views: 880, body: `<p>You can return most items within 30 days of delivery.</p><ol><li>Open a <strong>Return / Refund</strong> request with your order number and the items.</li><li>We'll email you a prepaid returns label.</li><li>Pack the item securely (original packaging if you have it) and drop it at any post office.</li></ol><p>Refunds go back to your original payment method within 3 working days of the item reaching us.</p>` },
  { title: "My item arrived damaged", category: "Orders & delivery", tags: ["damaged"], views: 410, body: `<p>Sorry about that! Please send us a photo of the item and the outer box within 7 days. We'll send a replacement right away — you don't need to return the damaged item.</p>` },
  { title: "Caring for linen and cotton textiles", category: "Product care", tags: ["care", "linen", "cushions"], views: 350, body: `<p>Wash at 30°C on a gentle cycle, inside out. Don't tumble dry — reshape and dry flat. Iron on medium while slightly damp for a crisp finish. Natural fibres can shrink up to 3% on the first wash.</p>` },
  { title: "Do you ship internationally?", category: "Orders & delivery", tags: ["shipping", "international"], views: 300, body: `<p>We ship to the UK, Ireland and most EU countries. Delivery to Ireland is a flat £9.95. EU orders may be subject to local import charges, which are shown at checkout.</p>` },
  { title: "Changing or cancelling an order", category: "Orders & delivery", tags: ["orders"], views: 260, body: `<p>We pack orders fast, so contact us within 1 hour of ordering if you need to change or cancel. After dispatch, use our free returns instead.</p>` },
];

function storeLike(cfg: BusinessConfig) {
  return cfg.features.csat && !cfg.features.changeManagement && cfg.ticketTypes.some((t) => /order|return/.test(t.key));
}

export async function seedExtras(db: Db, cfg: BusinessConfig): Promise<void> {
  if (cfg.features.knowledgeBase) await seedKb(db, cfg);
  if (cfg.features.serviceCatalog) await seedCatalog(db, cfg);
  if (cfg.features.csat) await seedCsat(db);
  await seedAutomation(db, cfg);
  await seedItsm(db, cfg);
}

async function seedKb(db: Db, cfg: BusinessConfig) {
  const author = await db.user.findFirst({ where: { roles: { some: { role: { key: { in: ["team_lead", "admin"] } } } } }, orderBy: { createdAt: "asc" } });
  if (!author) return;
  const actor = (await loadUserActor(db, author.id))!;
  const articles = storeLike(cfg) ? STORE_ARTICLES : IT_ARTICLES;
  const cats = new Map<string, string>();
  for (const [i, name] of [...new Set(articles.map((a) => a.category))].entries()) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const c = await db.kbCategory.upsert({ where: { slug }, create: { slug, name, order: i }, update: {} });
    cats.set(name, c.id);
  }
  for (const a of articles) {
    if (await db.knowledgeArticle.findFirst({ where: { title: a.title } })) continue;
    const { id } = await createArticle(actor, { title: a.title, body: a.body, categoryId: cats.get(a.category), tags: a.tags, visibility: a.visibility ?? "PUBLIC", status: "PUBLISHED" });
    const helpful = Math.round(a.views * 0.12);
    await db.knowledgeArticle.update({ where: { id }, data: { viewCount: a.views, helpfulCount: helpful, notHelpfulCount: Math.round(helpful * 0.15) } });
  }
  // One draft so the workflow is visible.
  if (!(await db.knowledgeArticle.findFirst({ where: { status: "DRAFT" } }))) {
    await createArticle(actor, { title: storeLike(cfg) ? "Gift wrapping options (draft)" : "Using the new meeting room displays (draft)", body: "<p>Work in progress.</p>", categoryId: [...cats.values()][0] });
  }
  console.log(`  knowledge base: ${articles.length} articles`);
}

async function seedCatalog(db: Db, _cfg: BusinessConfig) {
  const items = await db.catalogItem.findMany({ where: { isActive: true } });
  const requesters = await db.user.findMany({ where: { roles: { some: { role: { key: "requester" } } } }, take: 3 });
  if (!items.length || !requesters.length) return;
  let n = 0;
  for (const [i, item] of items.slice(0, 3).entries()) {
    const actor = (await loadUserActor(db, requesters[i % requesters.length]!.id))!;
    const fields = (item.fields as { key: string; type: string; required?: boolean; options?: ({ value: string } | string)[] }[]) ?? [];
    const values: Record<string, unknown> = {};
    for (const f of fields) {
      if (!f.required) continue;
      const opt = f.options?.[0];
      values[f.key] =
        f.type === "date" ? new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10) : f.type === "dropdown" ? (typeof opt === "string" ? opt : opt?.value) : f.type === "multiselect" ? [typeof opt === "string" ? opt : opt?.value] : f.type === "number" ? 1 : "Jordan Lee";
    }
    try {
      await submitCatalogRequest(actor, item.key, { values, notes: "Thanks!" });
      n++;
    } catch (err) {
      console.warn(`  catalog request for ${item.key} skipped: ${(err as Error).message}`);
    }
  }
  console.log(`  service catalog: ${n} requests`);
}

async function seedCsat(db: Db) {
  // Surveys were created by the resolve hook while seeding; give most of them answers.
  const done = await db.ticket.findMany({ where: { statusCategory: { in: ["RESOLVED", "CLOSED"] }, mergedIntoId: null }, take: 60 });
  const ratings = [5, 5, 4, 5, 3, 4, 5, 2, 5, 4];
  const comments = ["Super quick, thank you!", "", "Sorted first time.", "", "Took a while but got there.", "", "Great service as always", "Had to chase twice.", "", ""];
  let n = 0;
  for (const [i, t] of done.entries()) {
    const responded = i % 4 !== 3;
    const sentAt = t.resolvedAt ?? t.updatedAt;
    const data = {
      sentAt,
      rating: responded ? ratings[i % ratings.length]! : null,
      comment: responded ? comments[i % comments.length] || null : null,
      respondedAt: responded ? new Date(sentAt.getTime() + 3 * 3600_000) : null,
    };
    await db.cSATResponse.upsert({ where: { ticketId: t.id }, create: { ticketId: t.id, requesterId: t.requesterId, token: randomToken(24), ...data }, update: data });
    n++;
  }
  console.log(`  CSAT: ${n} surveys`);
}
