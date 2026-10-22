import { z } from "zod";
import { apiRoute } from "@/server/api";
import { db } from "@/server/db";

/** Requester picker for agents creating tickets on someone's behalf. */
export const GET = apiRoute({ permission: ["ticket.create_on_behalf", "user.view"], query: z.object({ q: z.string().trim().min(1).max(100) }) }, async ({ query }) =>
  db.user.findMany({
    where: { isActive: true, OR: [{ name: { contains: query.q, mode: "insensitive" } }, { email: { contains: query.q, mode: "insensitive" } }] },
    select: { id: true, name: true, email: true, organization: { select: { name: true } } },
    orderBy: { name: "asc" },
    take: 15,
  }),
);
