import { apiRoute } from "@/server/api";
import { bulkSchema, bulkUpdate } from "@/server/services/tickets";

export const POST = apiRoute({ permission: "ticket.bulk", body: bulkSchema, skipAudit: true, status: 200, rateLimit: 30 }, ({ actor, body, audit }) => bulkUpdate(actor, body, audit));
