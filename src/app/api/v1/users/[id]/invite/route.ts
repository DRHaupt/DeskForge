import { apiRoute, idParams } from "@/server/api";
import { sendInvite } from "@/server/services/account-flows";

/** Email the user a link to set their password. */
export const POST = apiRoute({ permission: "user.manage", params: idParams, skipAudit: true, status: 200, rateLimit: 20 }, ({ actor, params, audit }) => sendInvite(actor, params.id, audit));
