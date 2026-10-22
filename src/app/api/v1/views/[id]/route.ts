import { apiRoute, idParams } from "@/server/api";
import { deleteView, updateView, viewSchema } from "@/server/services/views";

export const PATCH = apiRoute({ authOnly: true, params: idParams, body: viewSchema.partial(), auditAction: "view.update" }, ({ actor, params, body }) => updateView(actor, params.id, body));
export const DELETE = apiRoute({ authOnly: true, params: idParams, auditAction: "view.delete" }, ({ actor, params }) => deleteView(actor, params.id));
