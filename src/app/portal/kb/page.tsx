import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getConfig } from "@/core/config/loader";
import { Highlight } from "@/components/console/highlight";
import { KbSearch } from "@/components/portal/kb-search";
import { db } from "@/server/db";
import { getSearchProvider } from "@/server/search";
import { getCurrentActor } from "@/server/session";
import { articleReadWhere } from "@/server/services/kb";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Help articles" };

export default async function PortalKb({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  if (!getConfig().features.knowledgeBase) notFound();
  const { q, category } = await searchParams;
  const actor = await getCurrentActor();
  const categories = await db.kbCategory.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }] });
  const current = categories.find((c) => c.slug === category);
  const hits = q?.trim() ? await getSearchProvider().searchArticles(actor, q.trim(), 30) : null;
  const articles = hits
    ? null
    : await db.knowledgeArticle.findMany({ where: { AND: [articleReadWhere(actor), current ? { categoryId: current.id } : {}] }, orderBy: [{ viewCount: "desc" }, { title: "asc" }], take: 100, select: { slug: true, title: true, excerpt: true, updatedAt: true } });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold">{current?.name ?? "Help articles"}</h1>
      {current?.description && <p className="mt-1 text-muted-foreground">{current.description}</p>}
      <div className="mt-6 max-w-2xl">
        <KbSearch initial={q ?? ""} />
      </div>
      <div className="mt-8 grid gap-8 md:grid-cols-[200px_1fr]">
        <nav aria-label="Categories">
          <ul className="space-y-1 text-sm">
            <li>
              <Link href="/portal/kb" className={cn("block rounded px-2 py-1 hover:bg-accent", !current && !q && "bg-primary/10 font-medium text-primary")}>
                All articles
              </Link>
            </li>
            {categories.map((c) => (
              <li key={c.id}>
                <Link href={`/portal/kb?category=${c.slug}`} aria-current={current?.id === c.id ? "page" : undefined} className={cn("block rounded px-2 py-1 hover:bg-accent", current?.id === c.id && "bg-primary/10 font-medium text-primary")}>
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          {hits && (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                {hits.length} result{hits.length === 1 ? "" : "s"} for “{q}”
              </p>
              <ul className="space-y-5">
                {hits.map((h) => (
                  <li key={h.id}>
                    <Link href={`/portal/kb/${h.slug}`} className="text-lg font-medium text-primary hover:underline">
                      {h.title}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      <Highlight text={h.snippet} />
                    </p>
                  </li>
                ))}
              </ul>
              {hits.length === 0 && (
                <p className="text-muted-foreground">
                  Nothing found.{" "}
                  <Link href={actor ? "/portal/new" : "/login?callbackUrl=/portal/new"} className="text-primary hover:underline">
                    Ask us instead
                  </Link>
                  .
                </p>
              )}
            </>
          )}
          {articles && (
            <ul className="divide-y rounded-lg border">
              {articles.map((a) => (
                <li key={a.slug} className="px-4 py-3">
                  <Link href={`/portal/kb/${a.slug}`} className="font-medium hover:underline">
                    {a.title}
                  </Link>
                  {a.excerpt && <p className="line-clamp-2 text-sm text-muted-foreground">{a.excerpt}</p>}
                </li>
              ))}
              {articles.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No articles here yet.</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
