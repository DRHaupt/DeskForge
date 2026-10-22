import { z } from "zod";
import { apiRoute } from "@/server/api";
import { unlinkTicket } from "@/server/services/tickets";

export const DELETE = apiRoute({ permission: "ticket.link", params: z.object({ id: z.string().max(64), linkId: z.string().max(64) }), skipAudit: true }, ({ actor, params, audit }) =>
  unlinkTicket(actor, params.id, params.linkId, audit),
);
