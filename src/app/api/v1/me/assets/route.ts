import { apiRoute } from "@/server/api";
import { listMyAssets } from "@/server/services/assets";

/** Assets assigned to the caller (portal "affected device" picker). */
export const GET = apiRoute({}, ({ actor }) => listMyAssets(actor));
