import { apiRoute, idParams } from "@/server/api";
import { addComment, commentSchema } from "@/server/services/tickets";

export const POST = apiRoute({ permission: ["ticket.reply", "ticket.comment_internal"], params: idParams, body: commentSchema, auditAction: "ticket.comment" }, ({ actor, params, body, audit }) =>
  addComment(actor, params.id, body, { ctx: audit, source: actor.kind === "api_key" ? "API" : "WEB" }),
);
