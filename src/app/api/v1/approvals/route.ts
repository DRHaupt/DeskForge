import { z } from "zod";
import { apiRoute } from "@/server/api";
import { listMyApprovals } from "@/server/services/catalog";

export const GET = apiRoute({ authOnly: true, query: z.object({ status: z.enum(["PENDING", "DECIDED"]).default("PENDING") }) }, ({ actor, query }) => listMyApprovals(actor, query.status));
