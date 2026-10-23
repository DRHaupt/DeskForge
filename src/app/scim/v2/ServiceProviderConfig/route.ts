import { serviceProviderConfig } from "@/server/scim";
import { scimJson, scimRoute } from "@/server/scim-route";

export const dynamic = "force-dynamic";
export const GET = scimRoute(async () => scimJson(serviceProviderConfig()));
