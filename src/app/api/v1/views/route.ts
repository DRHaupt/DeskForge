import { apiRoute } from "@/server/api";
import { createView, listViews, viewSchema } from "@/server/services/views";

export const GET = apiRoute({ authOnly: true }, ({ actor }) => listViews(actor));
export const POST = apiRoute({ permission: "ticket.view_own", body: viewSchema, auditAction: "view.create" }, ({ actor, body }) => createView(actor, body));
