import { HttpError, apiRoute } from "@/server/api";
import { beginEnrollment, twoFactorStatus } from "@/server/services/two-factor";

const userOnly = <T,>(actor: { kind: string }, fn: () => T) => {
  if (actor.kind !== "user") throw new HttpError(400, "Two-factor settings belong to a signed-in user, not an API key");
  return fn();
};

export const GET = apiRoute({ authOnly: true, allowTwoFactorSetup: true }, ({ actor }) => userOnly(actor, () => twoFactorStatus(actor as never)));
/** Start enrolment: returns a fresh secret and QR code. */
export const POST = apiRoute({ authOnly: true, allowTwoFactorSetup: true, status: 200, skipAudit: true, rateLimit: 10 }, ({ actor }) => userOnly(actor, () => beginEnrollment(actor as never)));
