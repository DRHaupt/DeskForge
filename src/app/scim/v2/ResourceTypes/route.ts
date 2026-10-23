import { LIST_SCHEMA, USER_SCHEMA } from "@/core/scim/scim";
import { appUrl } from "@/server/mail/templates";
import { scimJson, scimRoute } from "@/server/scim-route";

export const dynamic = "force-dynamic";

export const GET = scimRoute(async () =>
  scimJson({
    schemas: [LIST_SCHEMA],
    totalResults: 1,
    startIndex: 1,
    itemsPerPage: 1,
    Resources: [
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        id: "User",
        name: "User",
        endpoint: "/Users",
        schema: USER_SCHEMA,
        meta: { resourceType: "ResourceType", location: appUrl("/scim/v2/ResourceTypes/User") },
      },
    ],
  }),
);
