import { z } from "zod";
import { apiRoute, pageQuery } from "@/server/api";
import { createUser, createUserSchema, listUsers } from "@/server/services/admin";

export const GET = apiRoute(
  {
    permission: "user.view",
    query: pageQuery.extend({
      role: z.string().max(60).optional(),
      organizationId: z.string().max(64).optional(),
      active: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
    }),
  },
  ({ actor, query }) => listUsers(actor, query),
);

export const POST = apiRoute({ permission: "user.manage", body: createUserSchema, skipAudit: true }, ({ actor, body, audit }) =>
  createUser(actor, body, audit),
);
