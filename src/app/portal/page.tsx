import Link from "next/link";
import { BookOpen, ClipboardList, MessageSquarePlus, ShoppingBag } from "lucide-react";
import { getConfig } from "@/core/config/loader";
import { can } from "@/core/rbac/actor";
import { Card, CardContent } from "@/components/ui/card";
import { KbSearch } from "@/components/portal/kb-search";
import { db } from "@/server/db";
import { getCurrentActor } from "@/server/session";
import { articleReadWhere } from "@/server/services/kb";

export default async function PortalHome() {
  const cfg = getConfig();
  const actor = await getCurrentActor();
  const kb = cfg.features.knowledgeBase;
  const [categories, popular, openCount] = await Promise.all([
    kb ? db.kbCategory.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }], include: { _count: { select: { articles: { where: articleReadWhere(actor) } } } } }) : [],
    kb ? db.knowledgeArticle.findMany({ where: articleReadWhere(actor), orderBy: { viewCount: "desc" }, take: 6, select: { slug: true, title: true, excerpt: true } }) : [],
    actor ? db.ticket.count({ where: { requesterId: actor.id, deletedAt: null, statusCategory: { in: ["NEW", "OPEN", "PENDING"] } } }) : 0,
  ]);
  const actions = [
    { href: actor ? "/portal/new" : "/login?callbackUrl=/portal/new", icon: MessageSquarePlus, title: "Get help", text: "Report a problem or ask a question." },
    ...(cfg.features.serviceCatalog ? [{ href: actor ? "/portal/catalog" : "/login?callbackUrl=/portal/catalog", icon: ShoppingBag, title: "Request something", text: "Browse services you can request." }] : []),
    { href: actor ? "/portal/tickets" : "/login?callbackUrl=/portal/tickets", icon: ClipboardList, title: "My requests", text: actor ? `${openCount} open` : "Track what you've asked for." },
  ];

  return (
    <>
      <section className="border-b bg-primary/5">
        <div className="mx-auto max-w-3xl px-4 py-14 text-center">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{actor ? `Hi ${actor.name.split(" ")[0]}, how can we help?` : cfg.branding.name}</h1>
          <p className="mt-3 whitespace-pre-line text-muted-foreground">{cfg.branding.portalWelcome}</p>
          {kb && (
            <div className="mx-auto mt-8 max-w-2xl">
              <KbSearch />
            </div>
          )}
        </div>
      </section>
      <div className="mx-auto max-w-5xl space-y-12 px-4 py-10">
        <section aria-label="What would you like to do?" className="grid gap-4 sm:grid-cols-3">
          {actions.map((a) => (
            <Link key={a.title} href={a.href} className="group rounded-xl focus-visible:outline-2">
              <Card className="h-full transition-colors group-hover:border-primary/50">
                <CardContent className="flex items-start gap-3">
                  <span className="rounded-lg bg-primary/10 p-2 text-primary">
                    <a.icon className="size-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block font-semibold">{a.title}</span>
                    <span className="text-sm text-muted-foreground">{a.text}</span>
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>
        {kb && categories.length > 0 && (
          <section aria-labelledby="kb-cats">
            <h2 id="kb-cats" className="mb-4 text-lg font-semibold">
              Browse help topics
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((c) => (
                <Link key={c.id} href={`/portal/kb?category=${c.slug}`} className="rounded-lg border p-4 hover:border-primary/50 hover:bg-accent/40">
                  <span className="flex items-center gap-2 font-medium">
                    <BookOpen className="size-4 text-primary" aria-hidden /> {c.name}
                  </span>
                  {c.description && <span className="mt-1 block text-sm text-muted-foreground">{c.description}</span>}
                  <span className="mt-2 block text-xs text-muted-foreground">{c._count.articles} articles</span>
                </Link>
              ))}
            </div>
          </section>
        )}
        {kb && popular.length > 0 && (
          <section aria-labelledby="kb-popular">
            <h2 id="kb-popular" className="mb-4 text-lg font-semibold">
              Popular articles
            </h2>
            <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {popular.map((a) => (
                <li key={a.slug}>
                  <Link href={`/portal/kb/${a.slug}`} className="font-medium text-primary hover:underline">
                    {a.title}
                  </Link>
                  {a.excerpt && <p className="line-clamp-2 text-sm text-muted-foreground">{a.excerpt}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {actor && can(actor, "ticket.view_team") && <p className="text-center text-sm text-muted-foreground">You&apos;re viewing the customer portal as an agent.</p>}
      </div>
    </>
  );
}
