import { z } from "zod";
import { apiRoute } from "@/server/api";
import { getConfig } from "@/core/config/loader";
import { getSearchProvider } from "@/server/search";

/** Suggested articles while someone types a new ticket (public, rate-limited). */
export const GET = apiRoute({ public: true, optionalAuth: true, rateLimit: 120, query: z.object({ q: z.string().trim().max(200).default(""), limit: z.coerce.number().int().min(1).max(10).default(5) }) }, async ({ viewer, query }) => {
  if (!getConfig().features.knowledgeBase || query.q.length < 3) return { articles: [] };
  return { articles: await getSearchProvider().searchArticles(viewer, query.q, query.limit, "any") };
});
