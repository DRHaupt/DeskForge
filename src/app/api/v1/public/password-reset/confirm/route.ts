import { apiRoute } from "@/server/api";
import { confirmPasswordReset, resetConfirmSchema } from "@/server/services/account-flows";

export const POST = apiRoute({ public: true, body: resetConfirmSchema, rateLimit: 10, status: 200 }, ({ body, audit }) => confirmPasswordReset(body, audit));
