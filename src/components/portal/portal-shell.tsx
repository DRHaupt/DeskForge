import Link from "next/link";
import { getConfig } from "@/core/config/loader";
import { isAgent, type UserActor } from "@/core/rbac/actor";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/console/user-menu";

export function PortalShell({ actor, children }: { actor: UserActor | null; children: React.ReactNode }) {
  const cfg = getConfig();
  const links = [
    { href: "/portal", label: "Home" },
    ...(cfg.features.knowledgeBase ? [{ href: "/portal/kb", label: "Help articles" }] : []),
    ...(cfg.features.serviceCatalog && actor ? [{ href: "/portal/catalog", label: "Request something" }] : []),
    ...(actor ? [{ href: "/portal/tickets", label: "My tickets" }] : []),
  ];
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          <Link href="/portal">
            <BrandMark size={32} />
          </Link>
          <nav aria-label="Portal" className="ml-4 hidden gap-1 md:flex">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {actor ? (
              <>
                {isAgent(actor) && (
                  <Button asChild variant="outline" size="sm">
                    <Link href="/agent">Agent console</Link>
                  </Button>
                )}
                <UserMenu name={actor.name} email={actor.email} />
              </>
            ) : (
              <>
                {cfg.features.publicSignup && (
                  <Button asChild variant="ghost" size="sm">
                    <Link href="/signup">Sign up</Link>
                  </Button>
                )}
                <Button asChild size="sm">
                  <Link href="/login?callbackUrl=/portal">Sign in</Link>
                </Button>
              </>
            )}
          </div>
        </div>
        <nav aria-label="Portal (mobile)" className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-accent">
              {l.label}
            </Link>
          ))}
        </nav>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        <p>{cfg.branding.footer}</p>
        <p className="mt-1">
          <a className="underline-offset-4 hover:underline" href={`mailto:${cfg.branding.supportEmail}`}>
            {cfg.branding.supportEmail}
          </a>
          {cfg.branding.supportPhone && <> · {cfg.branding.supportPhone}</>}
        </p>
      </footer>
    </div>
  );
}
