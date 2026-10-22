/** Layout for agent and admin areas: sidebar, top bar, content. */
import Link from "next/link";
import { getConfig } from "@/core/config/loader";
import { canAny, type UserActor } from "@/core/rbac/actor";
import { BrandMark } from "@/components/brand/brand-mark";
import { NAV, type NavSection } from "./nav";
import { SidebarNav } from "./sidebar-nav";
import { MobileNav } from "./mobile-nav";
import { UserMenu } from "./user-menu";
import { CommandPalette } from "./command-palette";
import { isAgent } from "@/core/rbac/actor";

export function visibleNav(actor: UserActor): NavSection[] {
  const cfg = getConfig();
  return NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => (!i.permissions || canAny(actor, i.permissions)) && (!i.feature || cfg.features[i.feature])),
  })).filter((s) => s.items.length > 0);
}

export function ConsoleShell({ actor, children, topbar }: { actor: UserActor; children: React.ReactNode; topbar?: React.ReactNode }) {
  const sections = visibleNav(actor);
  const brand = <BrandMark size={28} />;
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-14 items-center border-b px-5">
          <Link href="/" className="min-w-0">
            {brand}
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav sections={sections} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-5">
          <MobileNav sections={sections} brand={brand} />
          <div className="min-w-0 flex-1">{topbar ?? (isAgent(actor) && <CommandPalette kb={getConfig().features.knowledgeBase} />)}</div>
          <UserMenu name={actor.name} email={actor.email} links={[{ href: "/portal", label: "Open customer portal" }]} />
        </header>
        <main id="main" className="flex-1 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
