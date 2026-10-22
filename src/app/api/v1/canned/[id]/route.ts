import { apiRoute, idParams } from "@/server/api";
import { cannedSchema, deleteCanned, updateCanned } from "@/server/services/canned";

export const PATCH = apiRoute({ permission: "ticket.reply", params: idParams, body: cannedSchema.partial(), skipAudit: true }, ({ actor, params, body, audit }) => updateCanned(actor, params.id, body, audit));
export const DELETE = apiRoute({ permission: "ticket.reply", params: idParams, skipAudit: true }, ({ actor, params, audit }) => deleteCanned(actor, params.id, audit));
