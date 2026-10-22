import { apiRoute, idParams } from "@/server/api";
import { decideApproval, decisionSchema } from "@/server/services/catalog";

export const POST = apiRoute({ authOnly: true, params: idParams, body: decisionSchema, skipAudit: true, status: 200 }, ({ actor, params, body, audit }) => decideApproval(actor, params.id, body, audit));
