import { apiRoute, idParams } from "@/server/api";
import { updateWatchers, watchersSchema } from "@/server/services/tickets";

export const POST = apiRoute({ authOnly: true, params: idParams, body: watchersSchema, skipAudit: true, status: 200 }, ({ actor, params, body, audit }) =>
  updateWatchers(actor, params.id, body, audit),
);
