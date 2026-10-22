import { apiRoute, idParams } from "@/server/api";
import { articleFeedback, feedbackSchema } from "@/server/services/kb";

/** "Was this helpful?" — anonymous allowed, rate-limited per IP. */
export const POST = apiRoute({ public: true, optionalAuth: true, params: idParams, body: feedbackSchema, rateLimit: 20, status: 200 }, ({ viewer, params, body }) => articleFeedback(viewer, params.id, body));
