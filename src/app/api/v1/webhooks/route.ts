import { apiRoute } from "@/server/api";
import { createWebhook, listWebhooks, webhookSchema } from "@/server/webhooks";

export const GET = apiRoute({ permission: "webhook.manage" }, ({ actor }) => listWebhooks(actor));
export const POST = apiRoute({ permission: "webhook.manage", body: webhookSchema, skipAudit: true }, ({ actor, body, audit }) => createWebhook(actor, body, audit));
