import { z } from "zod";
import { apiRoute } from "@/server/api";
import { db } from "@/server/db";
import { agentUserWhere } from "@/server/services/tickets";

/** Agents for assignee pickers and @mentions. */
export const GET = apiRoute(
  { permission: ["ticket.view_team", "ticket.view_all"], query: z.object({ q: z.string().max(100).optional(), teamId: z.string().max(64).optional() }) },
  async ({ query }) =>
    db.user.findMany({
      where: {
        ...agentUserWhere(),
        ...(query.q ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { email: { contains: query.q, mode: "insensitive" } }] } : {}),
        ...(query.teamId ? { teamMemberships: { some: { teamId: query.teamId } } } : {}),
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
      take: 20,
    }),
);
