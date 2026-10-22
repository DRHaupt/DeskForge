import { ConsoleShell } from "@/components/console/console-shell";
import { requireAgent } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireAgent("/agent");
  return <ConsoleShell actor={actor}>{children}</ConsoleShell>;
}
