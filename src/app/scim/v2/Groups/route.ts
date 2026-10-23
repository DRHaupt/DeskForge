import { LIST_SCHEMA, ScimError } from "@/core/scim/scim";
import { scimJson, scimRoute } from "@/server/scim-route";

export const dynamic = "force-dynamic";

/** Groups aren't synced (roles and teams are managed in DeskForge); report none. */
export const GET = scimRoute(async () => scimJson({ schemas: [LIST_SCHEMA], totalResults: 0, startIndex: 1, itemsPerPage: 0, Resources: [] }));
export const POST = scimRoute(async () => {
  throw new ScimError(501, "Group provisioning isn't supported. In Entra, turn off the Groups mapping under Provisioning → Mappings.");
});
