import { apiRoute, idParams } from "@/server/api";
import { serializeTicket } from "@/server/serialize";
import { deleteTicket, getTicket, updateTicket, updateTicketSchema } from "@/server/services/tickets";

export const GET = apiRoute({ authOnly: true, params: idParams }, async ({ actor, params }) => serializeTicket(actor, await getTicket(actor, params.id)));

export const PATCH = apiRoute({ permission: "ticket.update", params: idParams, body: updateTicketSchema, skipAudit: true }, ({ actor, params, body, audit }) =>
  updateTicket(actor, params.id, body, { ctx: audit }),
);

export const DELETE = apiRoute({ permission: "ticket.delete", params: idParams, skipAudit: true }, ({ actor, params, audit }) => deleteTicket(actor, params.id, audit));
