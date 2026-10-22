import { z } from "zod";
import { apiRoute } from "@/server/api";
import { requestPasswordReset } from "@/server/services/account-flows";

export const POST = apiRoute({ public: true, body: z.object({ email: z.email().max(320) }), rateLimit: 5, status: 200 }, ({ body, audit }) => requestPasswordReset(body.email, audit));
