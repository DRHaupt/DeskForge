import { apiRoute, idParams } from "@/server/api";
import { serializeTimeline } from "@/server/serialize";
import { getTicket, getTimeline } from "@/server/services/tickets";

export const GET = apiRoute({ authOnly: true, params: idParams }, async ({ actor, params }) => {
  const ticket = await getTicket(actor, params.id);
  return { items: serializeTimeline(await getTimeline(actor, ticket)) };
});
