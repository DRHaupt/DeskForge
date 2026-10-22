import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { getConfig } from "@/core/config/loader";
import { can } from "@/core/rbac/actor";
import { PageHeader } from "@/components/console/console-shell";
import { Pagination } from "@/components/console/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { timeAgo } from "@/lib/format";
import { requirePagePermission } from "@/server/session";
import { articleListSchema, listArticles, listKbCategories } from "@/server/services/kb";
import { CategoryManager } from "./category-manager";

export const metadata: Metadata = { title: "Knowledge base" };

export default async function AgentKb({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (!getConfig().features.knowledgeBase) notFound();
  const actor = await requirePagePermission(["kb.author", "kb.view_internal"], "/agent/kb");
  const sp = await searchParams;
  const f = articleListSchema.parse({ q: sp.q || undefined, status: sp.status || undefined, categoryId: sp.categoryId || undefined, page: sp.page, sort: sp.sort });
  const [result, categories] = await Promise.all([listArticles(actor, f), listKbCategories(actor)]);
  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Write articles once, answer the same question forever."
        actions={
          can(actor, "kb.author") && (
            <Button asChild>
              <Link href="/agent/kb/new">
                <Plus /> New article
              </Link>
            </Button>
          )
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <form className="mb-4 flex flex-wrap gap-2" role="search" aria-label="Filter articles">
            <Input name="q" defaultValue={sp.q} placeholder="Search titles and tags" className="max-w-xs" aria-label="Search" />
            <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
              <option value="">Any status</option>
              <option value="DRAFT">Draft</option>
              <option value="PUBLISHED">Published</option>
              <option value="ARCHIVED">Archived</option>
            </select>
            <select name="categoryId" defaultValue={sp.categoryId ?? ""} aria-label="Category" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
              <option value="">Any category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select name="sort" defaultValue={sp.sort ?? "updated"} aria-label="Sort" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
              <option value="updated">Recently updated</option>
              <option value="popular">Most viewed</option>
              <option value="title">Title</option>
            </select>
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </form>
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Article</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Views</TableHead>
                  <TableHead className="hidden md:table-cell">Helpful</TableHead>
                  <TableHead className="hidden sm:table-cell">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link href={`/agent/kb/${a.slug}`} className="font-medium hover:underline">
                        {a.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {a.category?.name ?? "Uncategorized"} · {a.author?.name ?? "—"}
                        {a.visibility === "INTERNAL" && " · internal"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={a.status === "PUBLISHED" ? "secondary" : "outline"}>{a.status.toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="hidden text-sm md:table-cell">{a.viewCount}</TableCell>
                    <TableCell className="hidden text-sm md:table-cell">
                      {a.helpfulCount + a.notHelpfulCount ? `${Math.round((a.helpfulCount / (a.helpfulCount + a.notHelpfulCount)) * 100)}%` : "—"}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{timeAgo(a.updatedAt)}</TableCell>
                  </TableRow>
                ))}
                {result.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      No articles yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
          <Pagination page={result.page} pageSize={result.pageSize} total={result.total} baseHref="/agent/kb" params={{ q: sp.q, status: sp.status, categoryId: sp.categoryId, sort: sp.sort }} />
        </div>
        <CategoryManager categories={categories.map((c) => ({ id: c.id, name: c.name, description: c.description, count: c._count.articles }))} canManage={can(actor, "kb.publish")} />
      </div>
    </>
  );
}
