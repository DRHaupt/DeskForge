import { apiRoute, idParams } from "@/server/api";
import { deleteTeam, getTeam, updateTeam, updateTeamSchema } from "@/server/services/admin";

export const GET = apiRoute({ permission: ["team.manage", "ticket.view_team"], params: idParams }, ({ actor, params }) => getTeam(actor, params.id));

export const PATCH = apiRoute({ permission: "team.manage", params: idParams, body: updateTeamSchema, skipAudit: true }, ({ actor, params, body, audit }) =>
  updateTeam(actor, params.id, body, audit),
);

export const DELETE = apiRoute({ permission: "team.manage", params: idParams, skipAudit: true }, ({ actor, params, audit }) => deleteTeam(actor, params.id, audit));
