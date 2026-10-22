import { apiRoute } from "@/server/api";
import { createRole, listRoles, roleSchema } from "@/server/services/admin";

export const GET = apiRoute({ permission: ["role.manage", "user.view"] }, ({ actor }) => listRoles(actor));

export const POST = apiRoute({ permission: "role.manage", body: roleSchema, skipAudit: true }, ({ actor, body, audit }) => createRole(actor, body, audit));
