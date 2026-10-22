"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

export function NewRoleDialog({ roles }: { roles: { id: string; name: string; permissions: string[] }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const copyFrom = roles.find((r) => r.id === f.get("copyFrom"));
    setPending(true);
    try {
      const res = await api<{ id: string }>("/api/v1/roles", {
        body: { key: f.get("key"), name: f.get("name"), description: f.get("description") || undefined, permissions: copyFrom?.permissions ?? [] },
      });
      toast.success("Role created");
      router.push(`/admin/roles/${res.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon /> New role
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>Start empty or copy the permissions of an existing role.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nr-name">Name</Label>
            <Input id="nr-name" name="name" required maxLength={80} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nr-key">Key</Label>
            <Input id="nr-key" name="key" required pattern="[a-z][a-z0-9_-]{1,40}" aria-describedby="nr-key-help" />
            <p id="nr-key-help" className="text-xs text-muted-foreground">
              Lowercase identifier used in config (workflow transitions), e.g. <code>night_shift</code>.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="nr-desc">Description</Label>
            <Input id="nr-desc" name="description" maxLength={500} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nr-copy">Copy permissions from</Label>
            <select id="nr-copy" name="copyFrom" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="">Nothing (empty role)</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Create role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
