"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

type Props = {
  role: { id: string; name: string; description: string | null; permissions: string[]; isSystem: boolean; userCount: number };
  groups: [string, { key: string; label: string; grantable: boolean }[]][];
};

export function RoleEditor({ role, groups }: Props) {
  const router = useRouter();
  const [all, setAll] = useState(role.permissions.includes("*"));
  const [perms, setPerms] = useState<Set<string>>(new Set(role.permissions));
  const [pending, setPending] = useState(false);

  const toggle = (key: string, on: boolean) =>
    setPerms((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    try {
      await api(`/api/v1/roles/${role.id}`, {
        method: "PATCH",
        body: { name: f.get("name"), description: f.get("description") || undefined, permissions: all ? ["*"] : [...perms].filter((p) => p !== "*") },
      });
      toast.success("Role saved");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function onDelete() {
    if (!confirm(`Delete role "${role.name}"?`)) return;
    try {
      await api(`/api/v1/roles/${role.id}`, { method: "DELETE" });
      toast.success("Role deleted");
      router.push("/admin/roles");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="re-name">Name</Label>
            <Input id="re-name" name="name" defaultValue={role.name} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="re-desc">Description</Label>
            <Input id="re-desc" name="description" defaultValue={role.description ?? ""} />
          </div>
          <label className="flex items-center gap-3 text-sm sm:col-span-2">
            <Switch checked={all} onCheckedChange={setAll} />
            Full access (every permission, including ones added in future versions)
          </label>
        </CardContent>
      </Card>
      {!all && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map(([group, items]) => (
            <Card key={group}>
              <CardHeader>
                <CardTitle className="text-base">{group}</CardTitle>
              </CardHeader>
              <CardContent>
                <fieldset className="space-y-2">
                  <legend className="sr-only">{group} permissions</legend>
                  {items.map((p) => (
                    <label key={p.key} className={`flex items-start gap-2 text-sm ${p.grantable ? "" : "opacity-50"}`} title={p.grantable ? undefined : "You don't have this permission, so you can't grant it."}>
                      <Checkbox className="mt-0.5" checked={perms.has(p.key)} disabled={!p.grantable} onCheckedChange={(v) => toggle(p.key, v === true)} />
                      <span>
                        {p.label}
                        <code className="block text-xs text-muted-foreground">{p.key}</code>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          Save role
        </Button>
        {!role.isSystem && (
          <Button type="button" variant="destructive" onClick={onDelete} disabled={role.userCount > 0} title={role.userCount > 0 ? "Remove this role from all users first" : undefined}>
            Delete role
          </Button>
        )}
      </div>
    </form>
  );
}
