import { apiRoute } from "@/server/api";
import { apiKeySchema, createApiKey, listApiKeys } from "@/server/services/api-key-admin";

export const GET = apiRoute({ permission: "apikey.manage" }, ({ actor }) => listApiKeys(actor));
export const POST = apiRoute({ permission: "apikey.manage", body: apiKeySchema, skipAudit: true, rateLimit: 20 }, ({ actor, body, audit }) => createApiKey(actor, body, audit));
