import { apiRoute } from "@/server/api";
import { signup, signupSchema } from "@/server/services/account-flows";

export const POST = apiRoute({ public: true, body: signupSchema, rateLimit: 5 }, ({ body, audit }) => signup(body, audit));
