import { apiRoute } from "@/server/api";
import { assetFilterSchema, exportAssetsCsv } from "@/server/services/assets";

export const GET = apiRoute({ permission: "asset.view", query: assetFilterSchema.partial(), rateLimit: 20 }, async ({ actor, query }) => {
  const csv = await exportAssetsCsv(actor, query);
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="assets-${new Date().toISOString().slice(0, 10)}.csv"` } });
});
