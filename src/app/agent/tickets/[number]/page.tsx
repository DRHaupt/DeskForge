import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getConfig } from "@/core/config/loader";
import { can } from "@/core/rbac/actor";
import { NotFoundError } from "@/core/errors";
import { buildTicketMeta } from "@/lib/ticket-meta";
import { db } from "@/server/db";
import { serializeTicket, serializeTimeline } from "@/server/serialize";
import { requireAgent } from "@/server/session";
import { agentUserWhere, getTicket, getTimeline } from "@/server/services/tickets";
import { workaroundsFor } from "@/server/services/problems";
import { TicketWorkspace } from "./ticket-workspace";

export async function generateMetadata({ params }: { params: Promise<{ number: string }> }): Promise<Metadata> {
  return { title: (await params).number };
}

export default async function TicketPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const actor = await requireAgent(`/agent/tickets/${number}`);
  const cfg = getConfig();
  let ticket;
  try {
    ticket = await getTicket(actor, number.toUpperCase());
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [timeline, teams, agents, categories, assets, canned] = await Promise.all([
    getTimeline(actor, ticket),
    db.team.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: agentUserWhere(), select: { id: true, name: true, teamMemberships: { select: { teamId: true } } }, orderBy: { name: "asc" } }),
    db.category.findMany({ where: { isActive: true }, select: { id: true, name: true, depth: true, path: true }, orderBy: [{ path: "asc" }] }),
    cfg.features.assets ? db.asset.findMany({ where: { deletedAt: null }, select: { id: true, tag: true, name: true }, orderBy: { tag: "asc" }, take: 500 }) : Promise.resolve([]),
    db.cannedResponse.findMany({ where: { OR: [{ isShared: true }, { ownerId: actor.id }] }, select: { id: true, name: true, body: true, actions: true }, orderBy: { name: "asc" } }),
  ]);
  const typeCfg = cfg.ticketTypes.find((t) => t.key === ticket.type.key);
  const [workarounds, cabVotes] = await Promise.all([
    cfg.features.problemManagement && !typeCfg?.feature ? workaroundsFor(ticket.id) : Promise.resolve([]),
    typeCfg?.feature === "changeManagement"
      ? db.approval.findMany({ where: { ticketId: ticket.id, kind: "CHANGE_CAB", status: { not: "NOT_REQUIRED" } }, include: { approver: { select: { name: true } } }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
  ]);

  return (
    <TicketWorkspace
      ticket={JSON.parse(JSON.stringify(serializeTicket(actor, ticket)))}
      timeline={JSON.parse(JSON.stringify(serializeTimeline(timeline)))}
      meta={buildTicketMeta(cfg)}
      me={{ id: actor.id, name: actor.name }}
      perms={{
        update: can(actor, "ticket.update"),
        reply: can(actor, "ticket.reply"),
        internal: can(actor, "ticket.comment_internal"),
        assign: can(actor, "ticket.assign"),
        reassign: can(actor, "ticket.reassign"),
        link: can(actor, "ticket.link"),
        delete: can(actor, "ticket.delete"),
        slaOverride: can(actor, "sla.override"),
      }}
      teams={teams}
      agents={agents.map((a) => ({ id: a.id, name: a.name, teamIds: a.teamMemberships.map((m) => m.teamId) }))}
      categories={categories.map((c) => ({ id: c.id, label: `${"— ".repeat(c.depth)}${c.name}` }))}
      assets={assets.map((a) => ({ id: a.id, label: `${a.tag} · ${a.name}` }))}
      canned={JSON.parse(JSON.stringify(canned))}
      features={{ problem: cfg.features.problemManagement, change: cfg.features.changeManagement, assets: cfg.features.assets }}
      itsm={{
        workarounds: workarounds.map((w) => ({ id: w.id, number: w.number, title: w.title, workaround: w.workaround })),
        cabVotes: cabVotes.map((v) => ({ id: v.id, name: v.approver.name, status: v.status, comment: v.comment, decidedAt: v.decidedAt?.toISOString() ?? null })),
        canRaiseProblem: cfg.features.problemManagement && !typeCfg?.feature && can(actor, "problem.manage"),
      }}
    />
  );
}
