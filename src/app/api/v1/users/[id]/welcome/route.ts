import { apiRoute, idParams } from "@/server/api";
import { sendWelcomeEmail } from "@/server/services/onboarding";

/** Email this user their onboarding link (/welcome). Returns the link too, for sharing another way. */
export const POST = apiRoute({ permission: "user.manage", params: idParams, skipAudit: true, status: 200, rateLimit: 30 }, ({ actor, params, audit }) => sendWelcomeEmail(actor, params.id, audit));
