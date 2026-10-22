import { apiRoute, idParams } from "@/server/api";
import { linkSchema, linkTicket } from "@/server/services/tickets";

export const POST = apiRoute({ permission: "ticket.link", params: idParams, body: linkSchema, skipAudit: true }, ({ actor, params, body, audit }) => linkTicket(actor, params.id, body, audit));
