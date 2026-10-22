import { z } from "zod";
import { apiRoute, idParams } from "@/server/api";
import { mergeTickets } from "@/server/services/tickets";

/** Merge this ticket INTO `target` (number or id). */
export const POST = apiRoute({ permission: "ticket.link", params: idParams, body: z.object({ target: z.string().min(1).max(64) }), skipAudit: true, status: 200 }, ({ actor, params, body, audit }) =>
  mergeTickets(actor, params.id, body.target, audit),
);
