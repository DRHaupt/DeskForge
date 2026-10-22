import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getConfig } from "@/core/config/loader";
import { can } from "@/core/rbac/actor";
import { NotFoundError } from "@/core/errors";
import { PageHeader } from "@/components/console/console-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/session";
import { getArticle } from "@/server/services/kb";

export const metadata: Metadata = { title: "Article" };

export default async function AgentArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await requirePagePermission(["kb.author", "kb.view_internal"], `/agent/kb/${slug}`);
  let a;
  try {
    a = await getArticle(actor, slug);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const tz = getConfig().locale.timezone;
  const feedback = await db.articleFeedback.findMany({ where: { articleId: a.id, comment: { not: null } }, orderBy: { createdAt: "desc" }, take: 10 });
  return (
    <div className="mx-auto max-w-4xl">
      <p className="mb-2 text-sm">
        <Link href="/agent/kb" className="text-muted-foreground hover:underline">
          ← Knowledge base
        </Link>
      </p>
      <PageHeader
        title={a.title}
        description={`${a.category?.name ?? "Uncategorized"} · by ${a.author?.name ?? "—"} · updated ${formatDateTime(a.updatedAt, tz)}`}
        actions={
          <>
            <Badge variant="outline">{a.status.toLowerCase()}</Badge>
            {a.visibility === "INTERNAL" && <Badge variant="outline">internal</Badge>}
            {a.status === "PUBLISHED" && a.visibility === "PUBLIC" && (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/portal/kb/${a.slug}`}>View in portal</Link>
              </Button>
            )}
            {can(actor, "kb.author") && (
              <Button asChild size="sm">
                <Link href={`/agent/kb/${a.slug}/edit`}>Edit</Link>
              </Button>
            )}
          </>
        }
      />
      <Card>
        <CardContent>
          <div className="prose-df text-base" dangerouslySetInnerHTML={{ __html: a.body }} />
        </CardContent>
      </Card>
      <p className="mt-4 text-sm text-muted-foreground">
        {a.viewCount} views · {a.helpfulCount} found it helpful · {a.notHelpfulCount} didn&apos;t
      </p>
      {feedback.length > 0 && (
        <Card className="mt-4">
          <CardContent>
            <p className="mb-2 text-sm font-semibold">Recent feedback</p>
            <ul className="space-y-2 text-sm">
              {feedback.map((f) => (
                <li key={f.id}>
                  {f.helpful ? "👍" : "👎"} {f.comment}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
