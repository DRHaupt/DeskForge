import { z } from "zod";
import { apiRoute } from "@/server/api";
import { createOrganization, listOrganizations, organizationSchema } from "@/server/services/admin";

export const GET = apiRoute({ permission: "org.view", query: z.object({ q: z.string().max(200).optional() }) }, ({ actor, query }) =>
  listOrganizations(actor, query.q),
);

export const POST = apiRoute({ permission: "org.manage", body: organizationSchema, skipAudit: true }, ({ actor, body, audit }) =>
  createOrganization(actor, body, audit),
);
