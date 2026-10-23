import { createScimUser, listScimUsers } from "@/server/scim";
import { scimBody, scimJson, scimRoute } from "@/server/scim-route";

export const dynamic = "force-dynamic";

export const GET = scimRoute(async ({ req }) => {
  const q = req.nextUrl.searchParams;
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  return scimJson(await listScimUsers({ filter: q.get("filter"), startIndex: num("startIndex"), count: num("count") }));
});

export const POST = scimRoute(async ({ req, audit }) => scimJson(await createScimUser(await scimBody(req), audit), 201));
