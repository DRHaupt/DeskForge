import { apiRoute, idParams } from "@/server/api";
import { articleSchema, deleteArticle, getArticle, updateArticle } from "@/server/services/kb";

export const GET = apiRoute({ public: true, optionalAuth: true, params: idParams }, ({ viewer, params }) => getArticle(viewer, params.id));
export const PATCH = apiRoute({ permission: "kb.author", params: idParams, body: articleSchema.partial(), skipAudit: true }, ({ actor, params, body, audit }) => updateArticle(actor, params.id, body, audit));
export const DELETE = apiRoute({ permission: "kb.publish", params: idParams, skipAudit: true }, ({ actor, params, audit }) => deleteArticle(actor, params.id, audit));
