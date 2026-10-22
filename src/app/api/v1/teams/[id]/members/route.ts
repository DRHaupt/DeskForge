import { apiRoute, idParams } from "@/server/api";
import { setTeamMembers, teamMembersSchema } from "@/server/services/admin";

/** Replace the full member list (add, remove, lead and availability flags). */
export const PUT = apiRoute({ permission: "team.manage", params: idParams, body: teamMembersSchema, skipAudit: true }, ({ actor, params, body, audit }) =>
  setTeamMembers(actor, params.id, body, audit),
);
