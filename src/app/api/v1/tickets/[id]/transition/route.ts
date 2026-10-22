import { apiRoute, idParams } from "@/server/api";
import { transitionSchema, transitionTicket } from "@/server/services/tickets";

/** Requesters may call this for transitions their role allows (e.g. close/reopen their own ticket). */
export const POST = apiRoute({ authOnly: true, params: idParams, body: transitionSchema, skipAudit: true, status: 200 }, ({ actor, params, body, audit }) =>
  transitionTicket(actor, params.id, body, { ctx: audit }),
);
