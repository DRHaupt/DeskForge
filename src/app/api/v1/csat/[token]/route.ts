import { z } from "zod";
import { apiRoute } from "@/server/api";
import { answerSurvey, csatAnswerSchema } from "@/server/services/csat";

/** Token-authenticated survey answer (no login needed). */
export const POST = apiRoute({ public: true, params: z.object({ token: z.string().min(20).max(100) }), body: csatAnswerSchema, rateLimit: 20, status: 200 }, ({ params, body }) => answerSurvey(params.token, body));
