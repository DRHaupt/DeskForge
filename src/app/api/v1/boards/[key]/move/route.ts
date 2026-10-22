import { z } from "zod";
import { apiRoute } from "@/server/api";
import { moveCard, moveSchema } from "@/server/services/boards";

const params = z.object({ key: z.string().min(1).max(60) });
export const POST = apiRoute({ permission: "ticket.update", params, body: moveSchema, status: 200, skipAudit: true }, ({ actor, params, body }) => moveCard(actor, params.key, body));
