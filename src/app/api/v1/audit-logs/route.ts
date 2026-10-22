import { z } from "zod";
import { apiRoute, pageQuery } from "@/server/api";
import { listAuditLogs } from "@/server/services/admin";

export const GET = apiRoute(
  {
    permission: "audit.view",
    query: pageQuery.extend({
      entityType: z.string().max(60).optional(),
      entityId: z.string().max(64).optional(),
      actorId: z.string().max(64).optional(),
      action: z.string().max(60).optional(),
    }),
  },
  ({ actor, query }) => listAuditLogs(actor, query),
);
