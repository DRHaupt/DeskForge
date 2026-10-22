import { apiRoute } from "@/server/api";
import { articleListSchema, articleSchema, createArticle, listArticles } from "@/server/services/kb";

/** Public: anonymous visitors see published public articles; staff see drafts too. */
export const GET = apiRoute({ public: true, optionalAuth: true, query: articleListSchema }, ({ viewer, query }) => listArticles(viewer, query));

export const POST = apiRoute({ permission: "kb.author", body: articleSchema, skipAudit: true }, ({ actor, body, audit }) => createArticle(actor, body, audit));
