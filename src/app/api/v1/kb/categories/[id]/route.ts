import { apiRoute, idParams } from "@/server/api";
import { deleteKbCategory, kbCategorySchema, updateKbCategory } from "@/server/services/kb";

export const PATCH = apiRoute({ permission: "kb.publish", params: idParams, body: kbCategorySchema.partial(), skipAudit: true }, ({ actor, params, body, audit }) => updateKbCategory(actor, params.id, body, audit));
export const DELETE = apiRoute({ permission: "kb.publish", params: idParams, skipAudit: true }, ({ actor, params, audit }) => deleteKbCategory(actor, params.id, audit));
