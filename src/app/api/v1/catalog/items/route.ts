import { z } from "zod";
import { apiRoute } from "@/server/api";
import { catalogItemSchema, createCatalogItem, listCatalogItems } from "@/server/services/catalog";

export const GET = apiRoute({ permission: "catalog.request", query: z.object({ all: z.enum(["true", "false"]).optional() }) }, ({ actor, query }) => listCatalogItems(actor, { includeInactive: query.all === "true" }));
export const POST = apiRoute({ permission: "catalog.manage", body: catalogItemSchema, skipAudit: true }, ({ actor, body, audit }) => createCatalogItem(actor, body, audit));
