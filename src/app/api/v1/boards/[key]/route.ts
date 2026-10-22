import { z } from "zod";
import { apiRoute } from "@/server/api";
import { boardFilterSchema, getBoard } from "@/server/services/boards";

const keyParams = z.object({ key: z.string().min(1).max(60) });
export const GET = apiRoute({ permission: ["ticket.view_team", "ticket.view_all"], params: keyParams, query: boardFilterSchema }, ({ actor, params, query }) => getBoard(actor, params.key, query));
