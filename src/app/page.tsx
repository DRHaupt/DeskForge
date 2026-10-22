import { redirect } from "next/navigation";
import { isAgent } from "@/core/rbac/actor";
import { getCurrentActor } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const actor = await getCurrentActor();
  redirect(actor && isAgent(actor) ? "/agent" : "/portal");
}
