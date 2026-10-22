import type { Metadata } from "next";
import { can } from "@/core/rbac/actor";
import { PageHeader } from "@/components/console/console-shell";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/session";
import { ArticleEditor } from "../editor";

export const metadata: Metadata = { title: "New article" };

export default async function NewArticle() {
  const actor = await requirePagePermission("kb.author", "/agent/kb/new");
  const categories = await db.kbCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New article" />
      <ArticleEditor article={{ title: "", body: "", excerpt: null, categoryId: null, visibility: "PUBLIC", tags: [], status: "DRAFT" }} categories={categories} canPublish={can(actor, "kb.publish")} />
    </div>
  );
}
