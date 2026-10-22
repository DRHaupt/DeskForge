import { apiRoute } from "@/server/api";
import { knownErrorFilter, listKnownErrors } from "@/server/services/problems";

export const GET = apiRoute({ permission: "ticket.comment_internal", query: knownErrorFilter }, ({ actor, query }) => listKnownErrors(actor, query));
