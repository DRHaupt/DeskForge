import { apiRoute, idParams } from "@/server/api";
import { revokeApiKey } from "@/server/services/api-key-admin";

export const DELETE = apiRoute({ permission: "apikey.manage", params: idParams, skipAudit: true }, ({ actor, params, audit }) => revokeApiKey(actor, params.id, audit));
