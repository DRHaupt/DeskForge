import { apiRoute } from "@/server/api";
import { listBoards } from "@/server/services/boards";

export const GET = apiRoute({ permission: ["ticket.view_team", "ticket.view_all"] }, async ({ actor }) => listBoards(actor));
