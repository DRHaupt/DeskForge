import { z } from "zod";
import { apiRoute } from "@/server/api";
import { EXPORTS, exportReportCsv, reportFilterSchema } from "@/server/services/reports";

const params = z.object({ kind: z.enum(EXPORTS) });

export const GET = apiRoute({ permission: "report.export", params, query: reportFilterSchema, rateLimit: 30 }, async ({ actor, params, query }) => {
  const csv = await exportReportCsv(actor, params.kind, query);
  const name = `${params.kind}-${query.range}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
});
