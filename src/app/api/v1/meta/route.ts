import { getConfig } from "@/core/config/loader";
import { activeTicketTypes } from "@/core/config/helpers";
import { isAgent } from "@/core/rbac/actor";
import { apiRoute } from "@/server/api";
import { db } from "@/server/db";

/** Everything a client needs to render ticket forms: types, fields, workflows, priorities, categories, teams. */
export const GET = apiRoute({ authOnly: true }, async ({ actor }) => {
  const cfg = getConfig();
  const staff = isAgent(actor);
  const [categories, teams] = await Promise.all([
    db.category.findMany({ where: { isActive: true }, orderBy: [{ depth: "asc" }, { order: "asc" }], select: { id: true, path: true, name: true, parentId: true, depth: true } }),
    staff ? db.team.findMany({ where: { isActive: true }, select: { id: true, key: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);
  return {
    ticketTypes: activeTicketTypes(cfg)
      .filter((t) => staff || t.portalVisible)
      .map((t) => ({
        key: t.key,
        name: t.name,
        description: t.description,
        prefix: t.prefix,
        fields: staff ? t.fields : t.fields.filter((f) => f.portal),
        states: t.workflow.states,
      })),
    priorities: cfg.priorities,
    categories,
    teams,
  };
});
