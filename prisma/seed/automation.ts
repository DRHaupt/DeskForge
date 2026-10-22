/** Demo automations and canned responses, derived from the business config. */
import type { BusinessConfig } from "../../src/core/config/schema";
import type { Db } from "../../src/server/db";
import { systemActor } from "../../src/core/rbac/actor";
import { loadUserActor } from "../../src/server/actor";
import { createAutomation } from "../../src/server/automation";
import { createCanned } from "../../src/server/services/canned";

function stateFor(cfg: BusinessConfig, category: string): string | undefined {
  const t = cfg.ticketTypes.find((x) => !x.feature) ?? cfg.ticketTypes[0];
  return t?.workflow.states.find((s) => s.category === category)?.key;
}

export async function seedAutomation(db: Db, cfg: BusinessConfig): Promise<void> {
  if (await db.automation.count()) return;
  const actor = systemActor("seed");
  const top = cfg.priorities.levels[0]!.key;
  const resolved = stateFor(cfg, "resolved");
  const closed = stateFor(cfg, "closed");

  await createAutomation(actor, {
    name: "Flag urgent wording",
    description: "Tags new tickets that mention outages or urgency so they stand out in queues.",
    trigger: "ticket.created",
    conditions: { all: [], any: [{ field: "title", op: "contains", value: "urgent" }, { field: "title", op: "contains", value: "down" }, { field: "title", op: "contains", value: "outage" }] },
    actions: [{ type: "add_tag", value: "urgent-wording" }, { type: "add_comment", visibility: "INTERNAL", body: "Flagged automatically: the title suggests this is urgent. Check the priority." }],
  });
  await createAutomation(actor, {
    name: "Tell team leads about SLA breaches",
    trigger: "sla.breached",
    conditions: { all: [], any: [] },
    actions: [{ type: "notify", to: ["team_leads"], subject: "SLA breached: {{ticket.number}}", message: "{{ticket.number}} ({{ticket.title}}) breached an SLA target. Priority {{ticket.priority}}, assignee {{assignee.name}}." }],
  });
  await createAutomation(actor, {
    name: "Top priority goes to a lead",
    description: "Adds an internal note when a ticket is raised to the highest priority.",
    trigger: "ticket.updated",
    conditions: { all: [{ field: "priority", op: "changed_to", value: top }], any: [] },
    actions: [{ type: "add_comment", visibility: "INTERNAL", body: "Priority raised to {{ticket.priority}}. Team leads have been notified." }, { type: "notify", to: ["team_leads"], message: "{{ticket.number}} was raised to {{ticket.priority}}: {{ticket.title}}" }],
  });
  if (resolved && closed) {
    await createAutomation(actor, {
      name: "Close resolved tickets after 3 days",
      trigger: "schedule",
      schedule: "every 60m",
      conditions: { all: [{ field: "status", op: "eq", value: resolved }, { field: "hoursInStatus", op: "gte", value: 72 }], any: [] },
      actions: [{ type: "set_status", value: closed }],
    });
  }

  const agent = await db.user.findFirst({ where: { roles: { some: { role: { key: { in: ["team_lead", "admin"] } } } } }, orderBy: { createdAt: "asc" } });
  if (!agent || (await db.cannedResponse.count())) return;
  const a = (await loadUserActor(db, agent.id))!;
  const open = stateFor(cfg, "open");
  const pending = cfg.ticketTypes[0]?.workflow.states.find((s) => s.category === "pending")?.key;
  await createCanned(a, { name: "Acknowledge and take it", body: "<p>Hi {{requester.name}},</p><p>Thanks for getting in touch — I've picked this up and will update you shortly.</p>", actions: [{ type: "assign_to_me" }, ...(open ? [{ type: "set_status" as const, value: open }] : [])] });
  await createCanned(a, { name: "Need more information", body: "<p>Hi {{requester.name}},</p><p>To look into this we need a little more detail. Could you reply with:</p><ul><li>When the problem started</li><li>Any error message you see (a screenshot is ideal)</li></ul>", actions: pending ? [{ type: "set_status", value: pending }] : [] });
  await createCanned(a, { name: "Resolved — please confirm", body: "<p>Hi {{requester.name}},</p><p>This should now be sorted. If anything's still not right, just reply and the ticket will reopen.</p>", actions: resolved ? [{ type: "set_status", value: resolved }] : [] });
  await createCanned(a, { name: "Duplicate of an existing ticket", body: "<p>Thanks — we're already tracking this issue in another ticket and will keep you updated there.</p>", actions: [{ type: "add_tag", value: "duplicate" }] });
  console.log("  automations and canned responses");
}
