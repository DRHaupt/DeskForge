import { apiRoute, idParams } from "@/server/api";
import { catalogRequestSchema, submitCatalogRequest } from "@/server/services/catalog";

export const POST = apiRoute({ permission: "catalog.request", params: idParams, body: catalogRequestSchema, skipAudit: true, rateLimit: 30 }, ({ actor, params, body, audit }) => submitCatalogRequest(actor, params.id, body, audit));
