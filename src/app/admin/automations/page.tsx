import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { CONDITION_FIELDS } from "@/core/automation/rules";
import { PageHeader } from "@/components/console/console-shell";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/session";
import { listAutomations } from "@/server/automation";
import { agentUserWhere } from "@/server/services/tickets";
import { AutomationsAdmin } from "./automations-admin";

export const metadata: Metadata = { title: "Automations" };

export default async function AutomationsPage() {
  const actor = await requirePagePermission("automation.manage", "/admin/automations");
  const cfg = getConfig();
  const [automations, teams, agents, webhooks] = await Promise.all([
    listAutomations(actor),
    db.team.findMany({ where: { isActive: true }, select: { key: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: agentUserWhere(), select: { email: true, name: true }, orderBy: { name: "asc" } }),
    db.webhook.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const customFields = [...new Map(cfg.ticketTypes.flatMap((t) => t.fields).map((f) => [f.key, f.label])).entries()];
  return (
    <>
      <PageHeader title="Automations" description="When something happens to a ticket (or on a schedule), check conditions and act. Actions go through the same rules as people." />
      <AutomationsAdmin
        automations={JSON.parse(JSON.stringify(automations))}
        fields={[...CONDITION_FIELDS.map((f) => ({ value: f, label: f })), ...customFields.map(([k, l]) => ({ value: `field.${k}`, label: `Custom: ${l}` }))]}
        priorities={cfg.priorities.levels.map((p) => ({ key: p.key, name: p.name }))}
        statuses={[...new Map(cfg.ticketTypes.flatMap((t) => t.workflow.states).map((s) => [s.key, s.name])).entries()].map(([key, name]) => ({ key, name }))}
        teams={teams}
        agents={agents}
        webhooks={webhooks}
      />
    </>
  );
}
