import Link from "next/link";
import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { PageHeader } from "@/components/console/console-shell";
import { Highlight } from "@/components/console/highlight";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getSearchProvider } from "@/server/search";
import { requireAgent } from "@/server/session";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireAgent("/agent/search");
  const q = ((await searchParams).q ?? "").trim().slice(0, 200);
  const kb = getConfig().features.knowledgeBase;
  const search = getSearchProvider();
  const [tickets, articles] = q ? await Promise.all([search.searchTickets(actor, q, 50), kb ? search.searchArticles(actor, q, 20) : []]) : [[], []];
  return (
    <>
      <PageHeader title="Search" description="Tickets, comments and knowledge base articles." />
      <form role="search" className="mb-6 flex max-w-xl gap-2">
        <Input name="q" defaultValue={q} placeholder="Search…" aria-label="Search" autoFocus />
        <Button type="submit">Search</Button>
      </form>
      {q && (
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2" aria-labelledby="res-tickets">
            <h2 id="res-tickets" className="mb-2 text-sm font-semibold">
              Tickets ({tickets.length})
            </h2>
            <Card className="gap-0 divide-y py-0">
              {tickets.map((t) => (
                <Link key={t.id} href={`/agent/tickets/${t.number}`} className="block px-4 py-3 hover:bg-muted/40">
                  <div className="font-medium">
                    <span className="mr-2 font-mono text-xs text-muted-foreground">{t.number}</span>
                    {t.title}
                  </div>
                  {t.snippet && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {t.matchedIn === "comment" && <span className="mr-1 text-xs">In a comment:</span>}
                      <Highlight text={t.snippet} />
                    </p>
                  )}
                </Link>
              ))}
              {tickets.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">No tickets match.</p>}
            </Card>
          </section>
          {kb && (
            <section aria-labelledby="res-articles">
              <h2 id="res-articles" className="mb-2 text-sm font-semibold">
                Articles ({articles.length})
              </h2>
              <Card className="gap-0 divide-y py-0">
                {articles.map((a) => (
                  <Link key={a.id} href={`/agent/kb/${a.slug}`} className="block px-4 py-3 hover:bg-muted/40">
                    <div className="font-medium">{a.title}</div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      <Highlight text={a.snippet} />
                    </p>
                  </Link>
                ))}
                {articles.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">No articles match.</p>}
              </Card>
            </section>
          )}
        </div>
      )}
    </>
  );
}
