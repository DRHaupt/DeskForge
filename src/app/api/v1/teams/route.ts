import { apiRoute } from "@/server/api";
import { createTeam, listTeams, teamSchema } from "@/server/services/admin";

export const GET = apiRoute({ permission: ["team.manage", "ticket.view_team"] }, ({ actor }) => listTeams(actor));

export const POST = apiRoute({ permission: "team.manage", body: teamSchema, skipAudit: true }, ({ actor, body, audit }) => createTeam(actor, body, audit));
