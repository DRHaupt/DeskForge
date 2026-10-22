import { z } from "zod";
import { apiRoute, idParams } from "@/server/api";
import { applyMacro } from "@/server/services/canned";

export const POST = apiRoute({ permission: "ticket.update", params: idParams, body: z.object({ cannedId: z.string().max(64) }), skipAudit: true, status: 200 }, ({ actor, params, body, audit }) =>
  applyMacro(actor, params.id, body.cannedId, audit),
);
