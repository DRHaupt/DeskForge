import { apiRoute, idParams } from "@/server/api";
import { sendTestWebhook } from "@/server/webhooks";

export const POST = apiRoute({ permission: "webhook.manage", params: idParams, auditAction: "webhook.test", status: 200, rateLimit: 20 }, ({ actor, params }) => sendTestWebhook(actor, params.id));
