import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can } from "@/core/rbac/actor";
import { NotFoundError } from "@/core/errors";
import { PageHeader } from "@/components/console/console-shell";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/session";
import { getArticle } from "@/server/services/kb";
import { ArticleEditor } from "../../editor";

export const metadata: Metadata = { title: "Edit article" };

export default async function EditArticle({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const actor = await requirePagePermission("kb.author", `/agent/kb/${slug}/edit`);
  let a;
  try {
    a = await getArticle(actor, slug);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const categories = await db.kbCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Edit: ${a.title}`} description={a.status !== "DRAFT" && !can(actor, "kb.publish") ? "Only publishers can change published articles." : undefined} />
      <ArticleEditor article={{ id: a.id, title: a.title, body: a.body, excerpt: a.excerpt, categoryId: a.categoryId, visibility: a.visibility, tags: a.tags, status: a.status }} categories={categories} canPublish={can(actor, "kb.publish")} />
    </div>
  );
}
