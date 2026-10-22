import { apiRoute } from "@/server/api";
import { createTicket, createTicketSchema, listTickets, ticketFilterSchema } from "@/server/services/tickets";

export const GET = apiRoute({ permission: ["ticket.view_own", "ticket.view_team", "ticket.view_all", "ticket.view_org"], query: ticketFilterSchema }, async ({ actor, query }) => {
  const res = await listTickets(actor, query);
  return {
    ...res,
    items: res.items.map((t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      type: t.type,
      status: t.status,
      statusCategory: t.statusCategory,
      priority: t.priority,
      requester: t.requester,
      assignee: t.assignee,
      team: t.team,
      organization: t.organization,
      tags: t.tags.map((x) => x.tag.name),
      sla: t.slaInstances,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  };
});

export const POST = apiRoute({ permission: "ticket.create", body: createTicketSchema, skipAudit: true }, ({ actor, body, audit }) => createTicket(actor, body, { ctx: audit, source: actor.kind === "api_key" ? "API" : undefined }));
