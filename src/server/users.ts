/** User provisioning shared by the admin API, OIDC sign-in, sign-up and email intake. */
import { getConfig } from "@/core/config/loader";
import { applyConfigTeamMembers } from "./config-sync";
import type { DbOrTx, Tx } from "./db";
import { db } from "./db";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Find an organization whose domains include this email's domain. */
export async function organizationForEmail(client: DbOrTx, email: string): Promise<string | null> {
  const domain = normalizeEmail(email).split("@")[1];
  if (!domain) return null;
  const org = await client.organization.findFirst({ where: { domains: { has: domain }, isActive: true }, select: { id: true } });
  return org?.id ?? null;
}

export type ProvisionInput = {
  email: string;
  name: string;
  passwordHash?: string | null;
  roleKeys?: string[];
  organizationId?: string | null;
};

/** Create a user with roles, auto-linking their organization and config team memberships. */
export async function provisionUser(input: ProvisionInput, client: typeof db = db) {
  const cfg = getConfig();
  const email = normalizeEmail(input.email);
  return client.$transaction(async (tx: Tx) => {
    const roleKeys = input.roleKeys?.length ? input.roleKeys : ["requester"];
    const roles = await tx.role.findMany({ where: { key: { in: roleKeys } } });
    const organizationId = input.organizationId !== undefined ? input.organizationId : await organizationForEmail(tx, email);
    const user = await tx.user.create({
      data: {
        email,
        name: input.name.trim() || email,
        passwordHash: input.passwordHash ?? null,
        passwordChangedAt: input.passwordHash ? new Date() : null,
        organizationId,
        orgTicketAccess: cfg.portal.requestersSeeOrgTickets,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
    });
    await applyConfigTeamMembers(tx, cfg, email);
    return user;
  });
}
