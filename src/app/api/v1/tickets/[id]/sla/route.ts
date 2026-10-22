import { z } from "zod";
import { apiRoute, idParams } from "@/server/api";
import { overrideSla } from "@/server/sla";

/** Team lead override of an SLA due date (with a reason, audited). */
export const POST = apiRoute(
  {
    permission: "sla.override",
    params: idParams,
    body: z.object({ metric: z.enum(["FIRST_RESPONSE", "RESOLUTION"]), dueAt: z.iso.datetime(), reason: z.string().trim().min(3).max(500) }),
    skipAudit: true,
    status: 200,
  },
  ({ actor, params, body, audit }) => overrideSla(actor, params.id, body, audit),
);
