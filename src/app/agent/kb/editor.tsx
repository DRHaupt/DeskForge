"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { RichTextEditor } from "@/components/tickets/rich-text-editor";
import { api } from "@/lib/api-client";

type Article = { id?: string; title: string; body: string; excerpt: string | null; categoryId: string | null; visibility: "PUBLIC" | "INTERNAL"; tags: string[]; status: "DRAFT" | "PUBLISHED" | "ARCHIVED" };
const sel = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

export function ArticleEditor({ article, categories, canPublish }: { article: Article; categories: { id: string; name: string }[]; canPublish: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState(article.body);
  const [pending, setPending] = useState(false);

  async function save(form: HTMLFormElement, status?: Article["status"]) {
    const f = new FormData(form);
    const payload = {
      title: f.get("title"),
      body,
      excerpt: (f.get("excerpt") as string) || null,
      categoryId: (f.get("categoryId") as string) || null,
      visibility: f.get("visibility"),
      tags: String(f.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      ...(status ? { status } : {}),
    };
    setPending(true);
    try {
      const res = article.id ? await api<{ slug: string }>(`/api/v1/kb/articles/${article.id}`, { method: "PATCH", body: payload }) : await api<{ slug: string }>("/api/v1/kb/articles", { body: payload });
      toast.success(status === "PUBLISHED" ? "Published" : status === "ARCHIVED" ? "Archived" : "Saved");
      router.push(`/agent/kb/${res.slug}`);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save(e.currentTarget);
      }}
    >
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ae-title">Title</Label>
            <Input id="ae-title" name="title" defaultValue={article.title} required minLength={3} maxLength={200} className="text-lg" />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Body</p>
            <RichTextEditor value={body} onChange={setBody} ariaLabel="Article body" minHeight={320} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ae-cat">Category</Label>
              <select id="ae-cat" name="categoryId" defaultValue={article.categoryId ?? ""} className={sel}>
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ae-vis">Visibility</Label>
              <select id="ae-vis" name="visibility" defaultValue={article.visibility} className={sel}>
                <option value="PUBLIC">Public (portal)</option>
                <option value="INTERNAL">Internal (agents only)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ae-tags">Tags</Label>
              <Input id="ae-tags" name="tags" defaultValue={article.tags.join(", ")} placeholder="vpn, remote" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ae-excerpt">Summary (shown in search results)</Label>
            <Input id="ae-excerpt" name="excerpt" defaultValue={article.excerpt ?? ""} maxLength={300} placeholder="Generated from the body if empty" />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="submit" variant="outline" disabled={pending}>
              {article.status === "DRAFT" ? "Save draft" : "Save"}
            </Button>
            {canPublish && article.status !== "PUBLISHED" && (
              <Button type="button" disabled={pending} onClick={(e) => save(e.currentTarget.form!, "PUBLISHED")}>
                Publish
              </Button>
            )}
            {canPublish && article.status === "PUBLISHED" && (
              <Button type="button" variant="ghost" disabled={pending} onClick={(e) => save(e.currentTarget.form!, "ARCHIVED")}>
                Archive
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
