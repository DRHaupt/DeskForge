import { apiRoute, idParams } from "@/server/api";
import { updateOrganization, updateOrganizationSchema } from "@/server/services/admin";

export const PATCH = apiRoute({ permission: "org.manage", params: idParams, body: updateOrganizationSchema, skipAudit: true }, ({ actor, params, body, audit }) =>
  updateOrganization(actor, params.id, body, audit),
);
