import { z } from "zod";
import { apiRoute } from "@/server/api";
import { getSearchProvider } from "@/server/search";
import { getConfig } from "@/core/config/loader";

export const GET = apiRoute(
  { authOnly: true, query: z.object({ q: z.string().trim().min(1).max(200), kind: z.enum(["all", "tickets", "articles"]).default("all"), limit: z.coerce.number().int().min(1).max(50).default(10) }) },
  async ({ actor, query }) => {
    const search = getSearchProvider();
    const kb = getConfig().features.knowledgeBase;
    const [tickets, articles] = await Promise.all([
      query.kind !== "articles" ? search.searchTickets(actor, query.q, query.limit) : [],
      query.kind !== "tickets" && kb ? search.searchArticles(actor, query.q, query.limit) : [],
    ]);
    return { tickets, articles };
  },
);
