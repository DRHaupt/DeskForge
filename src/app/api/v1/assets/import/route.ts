import { apiRoute } from "@/server/api";
import { importAssets, importSchema } from "@/server/services/assets";

export const POST = apiRoute({ permission: "asset.manage", body: importSchema, skipAudit: true, status: 200, rateLimit: 20 }, ({ actor, body, audit }) => importAssets(actor, body, audit));
