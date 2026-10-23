import { deleteScimUser, getScimUser, patchScimUser, replaceScimUser } from "@/server/scim";
import { scimBody, scimJson, scimRoute } from "@/server/scim-route";

export const dynamic = "force-dynamic";

export const GET = scimRoute(async ({ params }) => scimJson(await getScimUser(params.id!)));
export const PUT = scimRoute(async ({ req, params, audit }) => scimJson(await replaceScimUser(params.id!, await scimBody(req), audit)));
export const PATCH = scimRoute(async ({ req, params, audit }) => scimJson(await patchScimUser(params.id!, await scimBody(req), audit)));
export const DELETE = scimRoute(async ({ params, audit }) => {
  await deleteScimUser(params.id!, audit);
  return scimJson(null, 204);
});
