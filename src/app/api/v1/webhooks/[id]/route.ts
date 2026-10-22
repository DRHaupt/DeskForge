import { z } from "zod";
import { apiRoute, idParams } from "@/server/api";
import { deleteWebhook, updateWebhook, webhookSchema } from "@/server/webhooks";

export const PATCH = apiRoute({ permission: "webhook.manage", params: idParams, body: webhookSchema.partial().extend({ rotateSecret: z.boolean().optional() }), skipAudit: true }, ({ actor, params, body, audit }) =>
  updateWebhook(actor, params.id, body, audit),
);
export const DELETE = apiRoute({ permission: "webhook.manage", params: idParams, skipAudit: true }, ({ actor, params, audit }) => deleteWebhook(actor, params.id, audit));
