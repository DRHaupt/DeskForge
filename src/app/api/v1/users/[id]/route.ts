import { apiRoute, idParams } from "@/server/api";
import { getUser, updateUser, updateUserSchema } from "@/server/services/admin";

export const GET = apiRoute({ permission: "user.view", params: idParams }, ({ actor, params }) => getUser(actor, params.id));

export const PATCH = apiRoute({ permission: "user.manage", params: idParams, body: updateUserSchema, skipAudit: true }, ({ actor, params, body, audit }) =>
  updateUser(actor, params.id, body, audit),
);
