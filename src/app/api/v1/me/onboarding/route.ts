import { apiRoute, HttpError } from "@/server/api";
import { completeOnboarding, homeFor, onboardingState } from "@/server/services/onboarding";

export const GET = apiRoute({ authOnly: true, allowTwoFactorSetup: true }, async ({ actor }) => {
  if (actor.kind !== "user") throw new HttpError(400, "Not a user session");
  return onboardingState(actor);
});

/** Finish onboarding (after the MFA step). Returns where to go next. */
export const POST = apiRoute({ authOnly: true, status: 200, skipAudit: true }, async ({ actor, audit }) => {
  if (actor.kind !== "user") throw new HttpError(400, "Not a user session");
  await completeOnboarding(actor, audit);
  return { next: homeFor(actor) };
});
