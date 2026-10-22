import { HttpError, apiRoute } from "@/server/api";
import { disableSchema, disableTwoFactor } from "@/server/services/two-factor";

export const POST = apiRoute({ authOnly: true, body: disableSchema, status: 200, skipAudit: true, rateLimit: 10 }, ({ actor, body, audit }) => {
  if (actor.kind !== "user") throw new HttpError(400, "Not available for API keys");
  return disableTwoFactor(actor, body, audit);
});
