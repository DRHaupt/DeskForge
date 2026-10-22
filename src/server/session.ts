/** Current-request identity for server components, server actions and route handlers. */
import { cache } from "react";
import { forbidden, redirect } from "next/navigation";
import type { Permission } from "@/core/rbac/permissions";
import { can, isAgent, type UserActor } from "@/core/rbac/actor";
import { auth } from "./auth";
import { loadUserActor } from "./actor";
import { db } from "./db";

/** The signed-in user as an Actor, or null. Cached per request. */
export const getCurrentActor = cache(async (): Promise<UserActor | null> => {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return null;
  const sv = (session as unknown as { sv?: number }).sv;
  return loadUserActor(db, userId, sv);
});

/**
 * For pages: redirect to login when signed out, and to 2FA setup when the
 * user's role requires it and they haven't enrolled yet.
 */
export async function requireActor(callbackUrl?: string, opts: { allowTwoFactorSetup?: boolean } = {}): Promise<UserActor> {
  const actor = await getCurrentActor();
  if (!actor) redirect(`/login${callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`);
  if (actor.mustEnrollTwoFactor && !opts.allowTwoFactorSetup) redirect("/account/two-factor?required=1");
  return actor;
}

/** For pages: require a permission, rendering the 403 page otherwise. */
export async function requirePagePermission(permission: Permission | Permission[], callbackUrl?: string): Promise<UserActor> {
  const actor = await requireActor(callbackUrl);
  const perms = Array.isArray(permission) ? permission : [permission];
  if (!perms.some((p) => can(actor, p))) forbidden();
  return actor;
}

export async function requireAgent(callbackUrl?: string): Promise<UserActor> {
  const actor = await requireActor(callbackUrl);
  if (!isAgent(actor)) redirect("/portal");
  return actor;
}
