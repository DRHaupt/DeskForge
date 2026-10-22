import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getConfig } from "@/core/config/loader";
import { can } from "@/core/rbac/actor";
import { NotFoundError } from "@/core/errors";
import { formatDate } from "@/lib/format";
import { getCurrentActor } from "@/server/session";
import { getArticle } from "@/server/services/kb";
import { ArticleFeedback } from "./feedback";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  try {
    const a = await getArticle(await getCurrentActor(), (await params).slug);
    return { title: a.title, description: a.excerpt ?? undefined };
  } catch {
    return { title: "Article" };
  }
}

export default async function PortalArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cfg = getConfig();
  if (!cfg.features.knowledgeBase) notFound();
  const actor = await getCurrentActor();
  let article;
  try {
    article = await getArticle(actor, slug, { countView: true });
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
        <Link href="/portal/kb" className="hover:underline">
          Help articles
        </Link>
        {article.category && (
          <>
            {" / "}
            <Link href={`/portal/kb?category=${article.category.slug}`} className="hover:underline">
              {article.category.name}
            </Link>
          </>
        )}
      </nav>
      <article>
        <h1 className="text-3xl font-semibold tracking-tight">{article.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Updated {formatDate(article.updatedAt, cfg.locale.timezone)}
          {article.visibility === "INTERNAL" && " · Internal article"}
          {article.status !== "PUBLISHED" && ` · ${article.status.toLowerCase()}`}
        </p>
        <div className="prose-df mt-6 text-base" dangerouslySetInnerHTML={{ __html: article.body }} />
        {article.attachments.length > 0 && (
          <ul className="mt-6 space-y-1 text-sm">
            {article.attachments.map((a) => (
              <li key={a.id}>
                <a href={`/api/v1/attachments/${a.id}`} className="text-primary hover:underline">
                  {a.filename}
                </a>
              </li>
            ))}
          </ul>
        )}
      </article>
      <ArticleFeedback id={article.id} />
      <div className="mt-10 rounded-lg border bg-muted/40 p-4 text-sm">
        Still need help?{" "}
        <Link href={actor ? "/portal/new" : "/login?callbackUrl=/portal/new"} className="font-medium text-primary hover:underline">
          Contact support
        </Link>
        {actor && can(actor, "kb.author") && (
          <>
            {" · "}
            <Link href={`/agent/kb/${article.slug}/edit`} className="text-primary hover:underline">
              Edit article
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
