import { HttpError, apiRoute } from "@/server/api";
import { codeSchema, confirmEnrollment } from "@/server/services/two-factor";

export const POST = apiRoute({ authOnly: true, allowTwoFactorSetup: true, body: codeSchema, status: 200, skipAudit: true, rateLimit: 10 }, ({ actor, body, audit }) => {
  if (actor.kind !== "user") throw new HttpError(400, "Not available for API keys");
  return confirmEnrollment(actor, body, audit);
});
