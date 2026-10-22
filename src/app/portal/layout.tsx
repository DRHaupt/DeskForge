import { PortalShell } from "@/components/portal/portal-shell";
import { getCurrentActor } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const actor = await getCurrentActor();
  return <PortalShell actor={actor}>{children}</PortalShell>;
}
