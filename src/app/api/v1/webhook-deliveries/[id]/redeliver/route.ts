import { apiRoute, idParams } from "@/server/api";
import { redeliver } from "@/server/webhooks";

export const POST = apiRoute({ permission: "webhook.manage", params: idParams, auditAction: "webhook.redeliver", status: 200, rateLimit: 30 }, ({ actor, params }) => redeliver(actor, params.id));
