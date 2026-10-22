import { apiRoute } from "@/server/api";
import { assetFilterSchema, assetInputSchema, createAsset, listAssets } from "@/server/services/assets";

export const GET = apiRoute({ permission: "asset.view", query: assetFilterSchema }, ({ actor, query }) => listAssets(actor, query));
export const POST = apiRoute({ permission: "asset.manage", body: assetInputSchema, skipAudit: true }, ({ actor, body, audit }) => createAsset(actor, body, audit));
