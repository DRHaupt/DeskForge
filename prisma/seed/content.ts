/**
 * Demo content: tickets in every state with realistic conversations, created
 * through the real services so numbering, workflow, assignment and audit all
 * behave exactly as in production. Works for any business config: scenarios
 * are picked by ticket-type key with a generic fallback.
 */
import type { BusinessConfig, FieldConfig, TicketTypeConfig } from "../../src/core/config/schema";
import { activeTicketTypes } from "../../src/core/config/helpers";
import { systemActor, type Actor } from "../../src/core/rbac/actor";
import type { Db } from "../../src/server/db";
import { loadUserActor } from "../../src/server/actor";
import { addComment, createTicket, transitionTicket } from "../../src/server/services/tickets";
import { reconcileTicketSla } from "../../src/server/sla";
import { seedExtras } from "./extras";

type Scenario = { title: string; body: string; reply?: string; note?: string; followUp?: string; resolution?: string; impact?: number; urgency?: number; tags?: string[] };

const IT: Record<string, Scenario[]> = {
  incident: [
    { title: "Laptop battery drains in under an hour", body: "My laptop battery goes from 100% to empty in about 50 minutes, even with the screen dimmed. It started last week.", reply: "Thanks for reporting this. Could you tell us the asset tag on the bottom of the laptop?", note: "Battery health report shows 41% design capacity — replacement needed.", followUp: "The tag is on a sticker that says LT-0042.", resolution: "We replaced the battery. Health report now shows 100% capacity.", impact: 2, urgency: 1, tags: ["hardware", "battery"] },
    { title: "Can't connect to the VPN from home", body: "The VPN client says 'authentication failed' even though my password works for email.", reply: "Can you try signing out of the VPN client completely and signing back in? We pushed a certificate update last night.", note: "Cert rollout missed 3 laptops — this is one of them.", resolution: "Re-issued the VPN certificate; connection confirmed working.", impact: 2, urgency: 0, tags: ["vpn", "remote"] },
    { title: "Shared printer on 2nd floor jams every few pages", body: "The printer by the kitchen jams on almost every print job. Paper looks fine.", reply: "We'll send someone to check the rollers today.", note: "Pickup roller worn. Ordered part #RM2-5452.", resolution: "Replaced the pickup roller and cleaned the paper path.", impact: 1, urgency: 1, tags: ["printer"] },
    { title: "Outlook keeps asking for my password", body: "Every few minutes Outlook pops up a password prompt. Entering it doesn't help.", reply: "This is usually a cached credential issue. We'll reset your Outlook profile remotely — please save any open drafts.", followUp: "Done, saved everything. Go ahead.", resolution: "Rebuilt the Outlook profile and cleared stale credentials from Credential Manager.", impact: 2, urgency: 1, tags: ["email"] },
    { title: "Website contact form returns an error", body: "When customers submit the contact form on our website they get a 500 error.", reply: "Thanks — we can reproduce it and are looking at the server logs now.", note: "SMTP relay credentials expired on the web server.", resolution: "Rotated the SMTP credentials; form submissions are being delivered again.", impact: 0, urgency: 1, tags: ["website"] },
    { title: "Whole office lost internet access", body: "Nobody in the office can reach the internet since about 9:10. Phones are down too.", reply: "We're on it — the firewall is not responding and we're contacting the ISP.", note: "ISP confirmed fiber cut in the street. ETA 2h. Failover to 4G enabled on firewall.", resolution: "ISP repaired the line. Service restored; 4G failover worked as designed in the meantime.", impact: 0, urgency: 0, tags: ["network", "outage"] },
    { title: "Monitor flickers when docked", body: "My external monitor flickers on and off when the laptop is in the dock.", reply: "Could you try a different cable? We'll also update the dock firmware.", impact: 2, urgency: 2, tags: ["hardware"] },
    { title: "Teams calls drop after 10 minutes", body: "Every Teams call I'm in drops after roughly ten minutes.", reply: "Are you on Wi-Fi or wired when this happens?", followUp: "Wi-Fi, in the small meeting room.", note: "AP in meeting room 2 has a firmware bug with roaming. Scheduling an update.", impact: 1, urgency: 1, tags: ["teams", "wifi"] },
  ],
  service_request: [
    { title: "New starter: account and laptop for Jordan", body: "Jordan starts on Monday in the finance team and needs an account, email and a laptop.", reply: "Thanks! We'll have everything ready by Friday afternoon.", note: "Laptop LT-0107 imaged and assigned.", resolution: "Account created, licenses assigned, laptop ready for pickup at reception.", tags: ["onboarding"] },
    { title: "Access to the Projects shared drive", body: "I need edit access to the Projects folder for the autumn campaign.", reply: "Approved by your manager — access granted. You may need to sign out and back in.", resolution: "Access granted.", tags: ["access"] },
    { title: "Install drawing software on lab machines", body: "Can we get the open-source drawing app installed on all Lab B machines for the workshop?", reply: "We'll package it and push it overnight.", tags: ["software"] },
    { title: "Request a second monitor", body: "I'd like a second monitor for my desk if one is available.", reply: "We have a spare 24\" monitor. Can you pick it up Thursday?", followUp: "Thursday works, thank you!", resolution: "Monitor collected.", tags: ["hardware"] },
    { title: "Set up a shared mailbox for events", body: "Please create events@ as a shared mailbox for the events committee.", tags: ["email"] },
  ],
  question: [
    { title: "How do I set up email on my phone?", body: "What settings do I use to get club email on my iPhone?", reply: "Install the Outlook app and sign in with your club email — it configures itself. There's a step-by-step guide in the help center too.", resolution: "Sent the guide; user confirmed it works." },
    { title: "Where do I find the Wi-Fi password for guests?", body: "We have visitors on Saturday. Is there a guest Wi-Fi?", reply: "Yes — the guest network password is printed on the card at reception and changes monthly.", resolution: "Answered." },
    { title: "Can I use my own laptop on the network?", body: "Am I allowed to connect my personal laptop?", reply: "Personal devices can use the guest network. For club resources please use a club laptop." },
  ],
  problem: [
    { title: "Recurring VPN authentication failures after certificate rollout", body: "Multiple incidents report VPN auth failures. Suspect certificate deployment gaps.", note: "Linked incidents show machines that were offline during the rollout window.", tags: ["vpn"] },
    { title: "Meeting-room Wi-Fi drops calls during roaming", body: "Several Teams call drops traced to AP roaming behaviour.", note: "Vendor bug ID 88213, fixed in firmware 8.10.", tags: ["wifi"] },
  ],
  change: [
    { title: "Update firewall firmware to 7.4.3", body: "Security update for the edge firewall. Requires a 15-minute outage.", note: "Tested on the lab unit. Rollback: boot alternate partition.", tags: ["network"] },
    { title: "Migrate file server to cloud storage", body: "Move the shared drives to cloud storage over two weekends.", tags: ["migration"] },
  ],
  task: [
    { title: "Redesign the club website homepage", body: "Refresh the homepage layout and update photos.", tags: ["website"] },
    { title: "Replace Lab A network switch", body: "The old switch is out of support. Swap for the new 24-port model.", tags: ["network"] },
    { title: "Document the backup process", body: "Write a KB article on how nightly backups work and how to restore.", tags: ["docs"] },
    { title: "Upgrade Wi-Fi access points", body: "Roll out new firmware to all access points.", tags: ["wifi"] },
  ],
};

const STORE: Record<string, Scenario[]> = {
  question: [
    { title: "Is the oak side table in stock?", body: "The oak side table shows 'coming soon'. Any idea when it will be back?", reply: "Good news — we expect new stock on the 14th. Want us to notify you when it lands?", followUp: "Yes please!", resolution: "Added to the restock notification list." },
    { title: "Can I change my delivery address?", body: "I just placed order FL-104233 but I'm moving next week. Can you ship to my new address?", reply: "Of course — please reply with the new address and we'll update it before dispatch." },
    { title: "Care instructions for linen cushions", body: "Can the linen cushion covers go in the washing machine?", reply: "Yes, 30°C gentle cycle, no tumble dry. Full care guide is in our help center.", resolution: "Answered." },
    { title: "Do you ship to Ireland?", body: "Do you deliver to Dublin and how much does it cost?", reply: "We do! Delivery to Ireland is a flat £9.95 and takes 3–5 working days.", resolution: "Answered." },
  ],
  order_issue: [
    { title: "Order arrived with a broken vase", body: "My order FL-104190 arrived today and the ceramic vase was smashed in the box.", reply: "We're so sorry! Could you send a photo of the vase and the packaging?", followUp: "Photos attached.", note: "Courier damage — claim filed with carrier.", resolution: "Replacement vase dispatched with extra packaging.", impact: 1, urgency: 0, tags: ["damaged"] },
    { title: "Still waiting for order FL-104011", body: "It's been 9 days and tracking hasn't updated since it left the warehouse.", reply: "We've asked the courier to investigate. We'll update you within 24 hours.", note: "Carrier ticket #C-77812 opened.", impact: 1, urgency: 0, tags: ["late"] },
    { title: "Wrong colour throw received", body: "I ordered the sage green throw but received a mustard one.", reply: "Apologies for the mix-up! We'll send the correct colour and a free returns label.", resolution: "Correct item delivered; return label sent.", impact: 1, urgency: 1, tags: ["wrong-item"] },
  ],
  return_request: [
    { title: "Return the rattan lamp — doesn't fit", body: "The lamp is lovely but too tall for my shelf. I'd like to return it.", reply: "No problem — here's your returns label. Refund is issued within 3 days of us receiving it.", resolution: "Return received and refund processed.", tags: ["refund"] },
    { title: "Refund not received yet", body: "I returned a rug two weeks ago and haven't seen the refund.", reply: "Let me check with our warehouse team.", note: "Return logged but refund stuck in payment queue.", tags: ["refund"] },
  ],
};

const GENERIC: Scenario[] = [
  { title: "Something isn't working as expected", body: "Please take a look when you have a moment.", reply: "Thanks, we're looking into it." },
  { title: "Quick question", body: "Could someone get back to me about this?", reply: "Happy to help — could you share a bit more detail?" },
];

function scenariosFor(cfg: BusinessConfig, typeKey: string): Scenario[] {
  const store = cfg.features.csat && !cfg.features.changeManagement && STORE[typeKey];
  return (store || IT[typeKey] || STORE[typeKey] || GENERIC) as Scenario[];
}

// Deterministic pseudo-random so the demo looks the same on every machine.
let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function demoValue(f: FieldConfig, typeKey: string): unknown {
  switch (f.type) {
    case "text":
      return /order/i.test(f.key) ? `FL-10${Math.floor(4000 + rand() * 999)}` : /cost/i.test(f.key) ? "CC-1001" : f.label.includes("name") ? "Jordan Lee" : "See description";
    case "textarea":
      return typeKey === "return_request" ? "1 × item" : "See description above.";
    case "number":
      return Math.max(f.min ?? 1, 1);
    case "dropdown":
      return pick(f.options ?? [{ value: "", label: "" }]).value;
    case "multiselect":
      return [f.options![0]!.value];
    case "date":
      return new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    case "checkbox":
      return false;
    default:
      return undefined;
  }
}

/** Shortest transition path from `from` to any state whose category is in `targets`. */
function pathTo(type: TicketTypeConfig, from: string, targets: string[]): string[] | null {
  const queue: [string, string[]][] = [[from, []]];
  const seen = new Set([from]);
  while (queue.length) {
    const [state, path] = queue.shift()!;
    const st = type.workflow.states.find((s) => s.key === state)!;
    if (path.length && targets.includes(st.category)) return path;
    for (const t of type.workflow.transitions) {
      if ((t.from.includes("*") || t.from.includes(state)) && !seen.has(t.to)) {
        seen.add(t.to);
        queue.push([t.to, [...path, t.to]]);
      }
    }
  }
  return null;
}

async function backdate(db: Db, ticketId: string, createdAt: Date) {
  await db.ticket.update({ where: { id: ticketId }, data: { createdAt } });
  await db.statusHistory.updateMany({ where: { ticketId, fromStatus: null }, data: { createdAt } });
}

/** Spread later events after the ticket's (backdated) creation time. */
async function retime(db: Db, ticketId: string, createdAt: Date) {
  const [comments, history] = await Promise.all([
    db.comment.findMany({ where: { ticketId }, orderBy: { createdAt: "asc" } }),
    db.statusHistory.findMany({ where: { ticketId, fromStatus: { not: null } }, orderBy: { createdAt: "asc" } }),
  ]);
  const events = [...comments.map((c) => ({ kind: "c" as const, id: c.id, at: c.createdAt })), ...history.map((h) => ({ kind: "h" as const, id: h.id, at: h.createdAt }))].sort((a, b) => a.at.getTime() - b.at.getTime());
  let t = createdAt.getTime();
  const span = Math.max(Date.now() - t - 3600_000, 3600_000);
  const step = Math.min(span / Math.max(events.length + 1, 2), 26 * 3600_000);
  for (const [idx, e] of events.entries()) {
    // First touch usually comes quickly; later updates are spread out.
    t += idx === 0 ? (8 + rand() * 50) * 60_000 : step * (0.4 + rand() * 0.8);
    const at = new Date(Math.min(t, Date.now() - 60_000));
    if (e.kind === "c") await db.comment.update({ where: { id: e.id }, data: { createdAt: at } });
    else await db.statusHistory.update({ where: { id: e.id }, data: { createdAt: at } });
  }
  const last = new Date(Math.min(t, Date.now() - 60_000));
  const ticket = await db.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const firstPublicStaff = await db.comment.findFirst({ where: { ticketId, visibility: "PUBLIC", authorId: { not: ticket.requesterId } }, orderBy: { createdAt: "asc" } });
  await db.ticket.update({
    where: { id: ticketId },
    data: {
      updatedAt: last,
      firstRespondedAt: firstPublicStaff?.createdAt ?? null,
      resolvedAt: ticket.resolvedAt ? last : null,
      closedAt: ticket.closedAt ? last : null,
    },
  });
}

export async function seedDemoContent(db: Db, cfg: BusinessConfig): Promise<void> {
  const requesters = await db.user.findMany({ where: { roles: { some: { role: { key: "requester" } } } }, select: { id: true } });
  const agents = await db.user.findMany({ where: { roles: { some: { role: { key: { in: ["agent", "team_lead"] } } } } }, select: { id: true } });
  if (!requesters.length || !agents.length) return;
  const agentActors = (await Promise.all(agents.map((a) => loadUserActor(db, a.id)))).filter(Boolean) as Actor[];
  const system = systemActor("seed");

  const types = activeTicketTypes(cfg);
  // Weight towards everyday ticket types.
  const plan: TicketTypeConfig[] = [];
  for (const t of types) {
    const n = t.feature || !t.portalVisible ? 6 : t.key === "incident" || t.key === "question" || t.key === "order_issue" ? 30 : 16;
    for (let i = 0; i < n; i++) plan.push(t);
  }
  const outcomes: string[][] = [["new"], ["open"], ["open"], ["pending"], ["resolved"], ["resolved"], ["closed"]];

  let created = 0;
  for (const [i, type] of plan.entries()) {
    const scenario = scenariosFor(cfg, type.key)[i % scenariosFor(cfg, type.key).length]!;
    const requesterId = pick(requesters).id;
    const requester = (await loadUserActor(db, requesterId))!;
    const agent = pick(agentActors);
    const fields: Record<string, unknown> = {};
    for (const f of type.fields) {
      if (f.required || rand() < 0.5) {
        const v = demoValue(f, type.key);
        if (v !== undefined) fields[f.key] = v;
      }
    }
    const impact = scenario.impact !== undefined ? cfg.priorities.impact[Math.min(scenario.impact, cfg.priorities.impact.length - 1)]?.key : pick(cfg.priorities.impact).key;
    const urgency = scenario.urgency !== undefined ? cfg.priorities.urgency[Math.min(scenario.urgency, cfg.priorities.urgency.length - 1)]?.key : pick(cfg.priorities.urgency).key;
    const daysAgo = Math.floor(rand() * 45) + (i % 7 === 0 ? 0 : 1);
    const createdAt = new Date(Date.now() - daysAgo * 86_400_000 - Math.floor(rand() * 8) * 3600_000);

    let ticket: { id: string; number: string };
    try {
      ticket = await createTicket(
        system,
        {
          type: type.key,
          title: scenario.title,
          description: `<p>${scenario.body}</p>`,
          requesterId,
          impact,
          urgency,
          fields,
          tags: scenario.tags ?? [],
        },
        { source: rand() < 0.35 ? "EMAIL" : type.portalVisible ? "PORTAL" : "AGENT" },
      );
    } catch (err) {
      console.warn(`  skipped a ${type.key} ticket: ${(err as Error).message}`);
      continue;
    }
    await backdate(db, ticket.id, createdAt);

    const outcome = daysAgo < 1 ? ["new"] : pick(outcomes);
    const path = outcome[0] === "new" ? [] : (pathTo(type, type.workflow.initial, outcome) ?? []);
    const commenter = (await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assigneeId;
    const staff = commenter ? ((await loadUserActor(db, commenter)) ?? agent) : agent;

    try {
      if (path.length && scenario.reply) await addComment(staff, ticket.id, { body: `<p>${scenario.reply}</p>` });
      if (path.length && scenario.note) await addComment(staff, ticket.id, { body: `<p>${scenario.note}</p>`, visibility: "INTERNAL" });
      for (const [step, to] of path.entries()) {
        const isLast = step === path.length - 1;
        const st = type.workflow.states.find((s) => s.key === to)!;
        const needsComment = type.workflow.transitions.some((t) => t.to === to && t.requireComment);
        const comment = st.category === "resolved" || st.category === "closed" ? (scenario.resolution ?? "Resolved.") : needsComment ? "Updating status." : undefined;
        await transitionTicket(system, ticket.id, { to, comment: comment ? `<p>${comment}</p>` : undefined, commentVisibility: "PUBLIC" });
        if (isLast && st.category === "pending" && scenario.followUp && rand() < 0.4) {
          // Requester answered — reopens into the queue.
          await addComment(requester, ticket.id, { body: `<p>${scenario.followUp}</p>` });
        }
      }
      if (path.length && !path.some((p) => ["resolved", "closed", "pending"].includes(type.workflow.states.find((s) => s.key === p)!.category)) && scenario.followUp) {
        await addComment(requester, ticket.id, { body: `<p>${scenario.followUp}</p>` });
      }
    } catch (err) {
      console.warn(`  ${ticket.number}: ${(err as Error).message}`);
    }
    await retime(db, ticket.id, createdAt);
    // Rebuild SLA timers from the backdated history.
    await db.sLAInstance.deleteMany({ where: { ticketId: ticket.id } });
    await reconcileTicketSla(ticket.id);
    created++;
  }
  // Mark overdue timers as breached/warned without running escalations on demo data.
  await db.$executeRaw`UPDATE sla_instances SET breached_at = due_at, warned_at = coalesce(warned_at, due_at) WHERE status = 'RUNNING' AND due_at < now() AND breached_at IS NULL`;
  await db.$executeRaw`UPDATE sla_instances SET warned_at = warn_at WHERE status = 'RUNNING' AND warn_at < now() AND warned_at IS NULL`;
  // A few in-app notifications so the bell isn't empty.
  for (const a of agents) {
    const mine = await db.ticket.findMany({ where: { assigneeId: a.id, statusCategory: { in: ["NEW", "OPEN"] } }, orderBy: { createdAt: "desc" }, take: 3 });
    await db.notification.createMany({ data: mine.map((t) => ({ userId: a.id, type: "ticket.assigned", title: `${t.number} assigned to you`, body: t.title, link: `/agent/tickets/${t.number}`, ticketId: t.id, createdAt: t.createdAt })) });
  }
  console.log(`  created ${created} demo tickets`);
  await seedExtras(db, cfg);
}
