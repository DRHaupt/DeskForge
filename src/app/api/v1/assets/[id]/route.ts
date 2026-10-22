import { apiRoute, idParams } from "@/server/api";
import { assetInputSchema, deleteAsset, getAsset, updateAsset } from "@/server/services/assets";

export const GET = apiRoute({ permission: "asset.view", params: idParams }, ({ actor, params }) => getAsset(actor, params.id));
export const PATCH = apiRoute({ permission: "asset.manage", params: idParams, body: assetInputSchema.partial(), skipAudit: true }, ({ actor, params, body, audit }) => updateAsset(actor, params.id, body, audit));
export const DELETE = apiRoute({ permission: "asset.manage", params: idParams, skipAudit: true }, ({ actor, params, audit }) => deleteAsset(actor, params.id, audit));
