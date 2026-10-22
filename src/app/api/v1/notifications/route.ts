import { z } from "zod";
import { apiRoute } from "@/server/api";
import { listNotifications, markRead, markReadSchema } from "@/server/services/notifications";

export const GET = apiRoute({ authOnly: true, query: z.object({ unread: z.enum(["true", "false"]).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }) }, ({ actor, query }) =>
  listNotifications(actor, { unreadOnly: query.unread === "true", limit: query.limit }),
);

/** Mark notifications read: { ids: [...] } or { all: true }. */
export const POST = apiRoute({ authOnly: true, body: markReadSchema, skipAudit: true, status: 200 }, ({ actor, body }) => markRead(actor, body));
