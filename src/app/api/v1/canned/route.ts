import { apiRoute } from "@/server/api";
import { cannedSchema, createCanned, listCanned } from "@/server/services/canned";

export const GET = apiRoute({ permission: "ticket.reply" }, ({ actor }) => listCanned(actor));
export const POST = apiRoute({ permission: "ticket.reply", body: cannedSchema, skipAudit: true }, ({ actor, body, audit }) => createCanned(actor, body, audit));
