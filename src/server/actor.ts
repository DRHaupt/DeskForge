/** Builds an Actor (identity + permissions) from a user id, fresh from the database. */
import { getConfig } from "@/core/config/loader";
import type { UserActor } from "@/core/rbac/actor";
import { expandPermissions } from "@/core/rbac/roles";
import type { DbOrTx } from "./db";

export async function loadUserActor(client: DbOrTx, userId: string, sessionVersion?: number): Promise<UserActor | null> {
  const user = await client.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } }, teamMemberships: { select: { teamId: true } } },
  });
  if (!user || !user.isActive) return null;
  if (sessionVersion !== undefined && user.sessionVersion !== sessionVersion) return null;
  return {
    kind: "user",
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles.map((r) => r.role.key),
    permissions: expandPermissions(user.roles.flatMap((r) => r.role.permissions)),
    organizationId: user.organizationId,
    orgTicketAccess: user.orgTicketAccess,
    teamIds: user.teamMemberships.map((m) => m.teamId),
    mustEnrollTwoFactor: mustEnroll(user.roles.map((r) => r.role.key), Boolean(user.passwordHash), user.totpEnabled),
  };
}

/**
 * Roles listed in auth.requireTwoFactorForRoles must use TOTP. This applies to
 * accounts with a password; single-sign-on users get MFA from their identity provider.
 */
function mustEnroll(roles: string[], hasPassword: boolean, totpEnabled: boolean): boolean {
  if (!hasPassword || totpEnabled) return false;
  const required = getConfig().auth.requireTwoFactorForRoles;
  return roles.some((r) => required.includes(r));
}
