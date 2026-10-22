import { apiRoute, idParams } from "@/server/api";
import { raiseProblem, raiseProblemSchema } from "@/server/services/problems";

/** Create a problem from this incident and link the incident to it. */
export const POST = apiRoute({ permission: "problem.manage", params: idParams, body: raiseProblemSchema }, ({ actor, params, body, audit }) => raiseProblem(actor, params.id, body, audit));
