import { apiRoute } from "@/server/api";
import { automationInputSchema } from "@/core/automation/rules";
import { createAutomation, listAutomations } from "@/server/automation";

export const GET = apiRoute({ permission: "automation.manage" }, ({ actor }) => listAutomations(actor));
export const POST = apiRoute({ permission: "automation.manage", body: automationInputSchema, skipAudit: true }, ({ actor, body, audit }) => createAutomation(actor, body, audit));
