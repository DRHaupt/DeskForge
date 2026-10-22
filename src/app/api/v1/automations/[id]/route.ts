import { apiRoute, idParams } from "@/server/api";
import { automationInputSchema } from "@/core/automation/rules";
import { deleteAutomation, updateAutomation } from "@/server/automation";

export const PATCH = apiRoute({ permission: "automation.manage", params: idParams, body: automationInputSchema.partial(), skipAudit: true }, ({ actor, params, body, audit }) => updateAutomation(actor, params.id, body, audit));
export const DELETE = apiRoute({ permission: "automation.manage", params: idParams, skipAudit: true }, ({ actor, params, audit }) => deleteAutomation(actor, params.id, audit));
