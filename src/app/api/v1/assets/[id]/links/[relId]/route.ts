import { z } from "zod";
import { apiRoute } from "@/server/api";
import { unlinkAssetTicket } from "@/server/services/assets";

const params = z.object({ id: z.string().min(1).max(64), relId: z.string().min(1).max(64) });
export const DELETE = apiRoute({ permission: "asset.manage", params, skipAudit: true }, ({ actor, params, audit }) => unlinkAssetTicket(actor, params.id, params.relId, audit));
