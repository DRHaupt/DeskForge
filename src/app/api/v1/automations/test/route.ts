import { z } from "zod";
import { apiRoute } from "@/server/api";
import { automationInputSchema } from "@/core/automation/rules";
import { testAutomation } from "@/server/automation";

/** Dry-run an automation's conditions against a ticket. Nothing is changed. */
export const POST = apiRoute({ permission: "automation.manage", body: z.object({ automation: automationInputSchema, ticket: z.string().min(1).max(64) }), skipAudit: true, status: 200 }, ({ actor, body }) =>
  testAutomation(actor, body.automation, body.ticket),
);
