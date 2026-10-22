/** API response shapes. Keep internal-only data (internal notes, agent-only fields) out of requester responses. */
import { getConfig } from "@/core/config/loader";
import { getTicketTypeConfig } from "@/core/config/helpers";
import type { Actor } from "@/core/rbac/actor";
import { canSeeInternal } from "@/core/tickets/access";
import { ticketFieldValues, transitionsFor, type TicketDetail, type TimelineItem } from "./services/tickets";

export function serializeTicket(actor: Actor, t: TicketDetail) {
  const staff = canSeeInternal(actor);
  const typeCfg = getTicketTypeConfig(getConfig(), t.type.key);
  const values = ticketFieldValues(t);
  const fields = Object.fromEntries(
    Object.entries(values).filter(([k]) => staff || typeCfg?.fields.find((f) => f.key === k)?.portal !== false),
  );
  return {
    id: t.id,
    number: t.number,
    type: { key: t.type.key, name: t.type.name },
    title: t.title,
    description: t.description,
    status: t.status,
    statusCategory: t.statusCategory,
    priority: t.priority,
    impact: t.impact,
    urgency: t.urgency,
    source: t.source,
    requester: { id: t.requester.id, name: t.requester.name, email: t.requester.email },
    organization: t.organization,
    team: t.team,
    assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
    category: t.category,
    tags: t.tags.map((x) => x.tag.name),
    fields,
    watchers: staff ? t.watchers.map((w) => ({ userId: w.userId, email: w.user?.email ?? w.email, name: w.user?.name ?? null })) : undefined,
    links: [
      ...t.outgoingLinks.map((l) => ({ id: l.id, type: l.type, direction: "outgoing" as const, ticket: l.targetTicket, asset: l.targetAsset })),
      ...t.incomingLinks.map((l) => ({ id: l.id, type: l.type, direction: "incoming" as const, ticket: l.sourceTicket, asset: null })),
    ],
    mergedInto: t.mergedInto,
    sla: t.slaInstances.map((s) => ({ metric: s.metric, status: s.status, dueAt: s.dueAt, breachedAt: s.breachedAt, policy: s.policy.name })),
    dueAt: t.dueAt,
    firstRespondedAt: t.firstRespondedAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    transitions: transitionsFor(actor, t),
    ...(staff
      ? { rootCause: t.rootCause, workaround: t.workaround, knownError: t.knownError, riskLevel: t.riskLevel, changePlan: t.changePlan, rollbackPlan: t.rollbackPlan, plannedStartAt: t.plannedStartAt, plannedEndAt: t.plannedEndAt, cabStatus: t.cabStatus }
      : {}),
  };
}

export function serializeTimeline(items: TimelineItem[]) {
  return items.map((i) => {
    if (i.kind === "comment") {
      const c = i.comment;
      return {
        kind: i.kind,
        id: i.id,
        at: i.at,
        visibility: c.visibility,
        source: c.source,
        isSystem: c.isSystem,
        author: c.author ? { id: c.author.id, name: c.author.name } : null,
        body: c.body,
        attachments: c.attachments,
      };
    }
    return i;
  });
}
