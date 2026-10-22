import { apiRoute, idParams } from "@/server/api";
import { deleteRole, updateRole, updateRoleSchema } from "@/server/services/admin";

export const PATCH = apiRoute({ permission: "role.manage", params: idParams, body: updateRoleSchema, skipAudit: true }, ({ actor, params, body, audit }) =>
  updateRole(actor, params.id, body, audit),
);

export const DELETE = apiRoute({ permission: "role.manage", params: idParams, skipAudit: true }, ({ actor, params, audit }) => deleteRole(actor, params.id, audit));
