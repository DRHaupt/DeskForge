import { apiRoute, idParams } from "@/server/api";
import { deleteComment } from "@/server/services/tickets";

export const DELETE = apiRoute({ authOnly: true, params: idParams, skipAudit: true }, ({ actor, params, audit }) => deleteComment(actor, params.id, audit));
