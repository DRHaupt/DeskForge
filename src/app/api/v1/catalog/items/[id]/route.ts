import { apiRoute, idParams } from "@/server/api";
import { catalogItemSchema, getCatalogItem, updateCatalogItem } from "@/server/services/catalog";

export const GET = apiRoute({ permission: "catalog.request", params: idParams }, ({ actor, params }) => getCatalogItem(actor, params.id));
export const PATCH = apiRoute({ permission: "catalog.manage", params: idParams, body: catalogItemSchema.partial(), skipAudit: true }, ({ actor, params, body, audit }) => updateCatalogItem(actor, params.id, body, audit));
