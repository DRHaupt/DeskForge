import { canAny } from "@/core/rbac/actor";
import { forbidden } from "next/navigation";
import { ConsoleShell } from "@/components/console/console-shell";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor("/admin");
  if (!canAny(actor, ["user.view", "role.manage", "team.manage", "org.view", "audit.view", "config.view", "automation.manage", "webhook.manage", "apikey.manage"])) forbidden();
  return <ConsoleShell actor={actor}>{children}</ConsoleShell>;
}
