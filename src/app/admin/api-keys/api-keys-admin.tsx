"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";
import { timeAgo } from "@/lib/format";

type Key = { id: string; name: string; prefix: string; permissions: string[]; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string; createdBy: { name: string } | null };

export function ApiKeysAdmin({ keys, grantable }: { keys: Key[]; grantable: { key: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [perms, setPerms] = useState<string[]>(["ticket.view_all", "ticket.create"].filter((p) => grantable.some((g) => g.key === p)));
  const [created, setCreated] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const expires = f.get("expiresAt") as string;
    try {
      const res = await api<{ key: string }>("/api/v1/api-keys", { body: { name: f.get("name"), permissions: perms, expiresAt: expires ? new Date(`${expires}T23:59:59Z`).toISOString() : null } });
      setOpen(false);
      setCreated(res.key);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <Link href="/api-docs" className="text-sm text-primary hover:underline">
          API reference →
        </Link>
        <Button onClick={() => setOpen(true)}>
          <Plus /> New API key
        </Button>
      </div>
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>
                <span className="sr-only">Revoke</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id} className={k.revokedAt ? "opacity-50" : ""}>
                <TableCell>
                  <span className="font-medium">{k.name}</span> {k.revokedAt && <Badge variant="outline">Revoked</Badge>}
                  <div className="text-xs text-muted-foreground">
                    by {k.createdBy?.name ?? "—"} · {timeAgo(k.createdAt)}
                    {k.expiresAt && ` · expires ${new Date(k.expiresAt).toLocaleDateString()}`}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs">dfk_{k.prefix}_…</TableCell>
                <TableCell className="max-w-xs text-xs">{k.permissions.includes("*") ? "All (capped by creator)" : k.permissions.join(", ")}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{k.lastUsedAt ? timeAgo(k.lastUsedAt) : "never"}</TableCell>
                <TableCell className="text-right">
                  {!k.revokedAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        if (!confirm(`Revoke "${k.name}"? Integrations using it stop working immediately.`)) return;
                        await api(`/api/v1/api-keys/${k.id}`, { method: "DELETE" });
                        router.refresh();
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {keys.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No API keys yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>Give it only the permissions the integration needs.</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ak-name">Name</Label>
                <Input id="ak-name" name="name" required placeholder="e.g. Monitoring alerts" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ak-exp">Expires (optional)</Label>
                <Input id="ak-exp" name="expiresAt" type="date" />
              </div>
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Permissions</legend>
              <div className="grid max-h-64 gap-1 overflow-y-auto text-sm sm:grid-cols-2">
                {grantable.map((g) => (
                  <label key={g.key} className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={perms.includes(g.key)} onChange={(e) => setPerms((s) => (e.target.checked ? [...s, g.key] : s.filter((x) => x !== g.key)))} />
                    <span>
                      {g.label} <code className="block text-xs text-muted-foreground">{g.key}</code>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <DialogFooter>
              <Button type="submit" disabled={!perms.length}>
                Create key
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription>Copy it now — it can&apos;t be shown again. Send it as: Authorization: Bearer &lt;key&gt;</DialogDescription>
          </DialogHeader>
          <code className="block rounded bg-muted p-3 text-sm break-all select-all">{created}</code>
        </DialogContent>
      </Dialog>
    </>
  );
}
