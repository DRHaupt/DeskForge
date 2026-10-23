import { z } from "zod";
import { apiRoute, idParams } from "@/server/api";
import { sendSignInDetails } from "@/server/services/onboarding";

const body = z.object({ temporaryPassword: z.string().min(1).max(256) });

/** Email this user the temporary password from the identity provider. The password is never stored. */
export const POST = apiRoute({ permission: "user.manage", params: idParams, body, skipAudit: true, status: 200, rateLimit: 10 }, ({ actor, params, body, audit }) =>
  sendSignInDetails(actor, params.id, body.temporaryPassword, audit),
);
