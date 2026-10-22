import { apiRoute } from "@/server/api";
import { buildReport, reportFilterSchema } from "@/server/services/reports";

export const GET = apiRoute({ permission: "report.view", query: reportFilterSchema }, ({ actor, query }) => buildReport(actor, query));
