import { apiRoute, idParams } from "@/server/api";
import { assignSchema, assignTicket } from "@/server/services/tickets";

export const POST = apiRoute({ permission: ["ticket.assign", "ticket.reassign"], params: idParams, body: assignSchema, skipAudit: true, status: 200 }, ({ actor, params, body, audit }) =>
  assignTicket(actor, params.id, body, { ctx: audit }),
);
