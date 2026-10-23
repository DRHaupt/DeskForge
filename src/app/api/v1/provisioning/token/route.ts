import { apiRoute } from "@/server/api";
import { generateScimToken, removeScimToken } from "@/server/scim";

/** Create or replace the SCIM provisioning token. The token is returned once. */
export const POST = apiRoute({ permission: "user.manage", skipAudit: true, status: 201, rateLimit: 10 }, ({ actor, audit }) => generateScimToken(actor, audit));

/** Revoke the token: the identity provider can no longer provision users. */
export const DELETE = apiRoute({ permission: "user.manage", skipAudit: true }, async ({ actor, audit }) => {
  await removeScimToken(actor, audit);
  return { ok: true };
});
