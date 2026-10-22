"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

export function CategoryManager({ categories, canManage }: { categories: { id: string; name: string; description: string | null; count: number }[]; canManage: boolean }) {
  const router = useRouter();
  return (
    <Card className="h-fit gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Categories</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <ul className="space-y-1 text-sm">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {c.name} <span className="text-xs text-muted-foreground">({c.count})</span>
              </span>
              {canManage && (
                <button
                  aria-label={`Delete ${c.name}`}
                  className="rounded p-1 text-muted-foreground hover:bg-accent"
                  onClick={async () => {
                    if (!confirm(`Delete category "${c.name}"? Articles stay, uncategorized.`)) return;
                    await api(`/api/v1/kb/categories/${c.id}`, { method: "DELETE" });
                    router.refresh();
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          ))}
          {categories.length === 0 && <li className="text-muted-foreground">No categories yet.</li>}
        </ul>
        {canManage && (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const name = String(new FormData(form).get("name") ?? "").trim();
              if (!name) return;
              try {
                await api("/api/v1/kb/categories", { body: { name } });
                form.reset();
                router.refresh();
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          >
            <Input name="name" placeholder="New category" aria-label="New category name" className="h-8" />
            <Button size="sm" variant="secondary" type="submit">
              Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
