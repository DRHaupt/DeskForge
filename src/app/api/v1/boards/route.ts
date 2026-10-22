import { apiRoute } from "@/server/api";
import { listBoards } from "@/server/services/boards";

export const GET = apiRoute({}, async ({ actor }) => listBoards(actor));
