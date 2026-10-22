"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

export function NewUserDialog({ roles, organizations }: { roles: { key: string; name: string }[]; organizations: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<string[]>(["requester"]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    try {
      const res = await api<{ id: string }>("/api/v1/users", {
        body: {
          name: f.get("name"),
          email: f.get("email"),
          password: (f.get("password") as string) || undefined,
          roleKeys: selected,
          organizationId: (f.get("organizationId") as string) || undefined,
        },
      });
      toast.success("User created");
      setOpen(false);
      router.push(`/admin/users/${res.id}`);
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
          <PlusIcon /> New user
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
          <DialogDescription>Leave the password empty for users who sign in with single sign-on.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nu-name">Name</Label>
            <Input id="nu-name" name="name" required maxLength={120} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nu-email">Email</Label>
            <Input id="nu-email" name="email" type="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nu-password">Password (optional)</Label>
            <Input id="nu-password" name="password" type="password" autoComplete="new-password" />
          </div>
          {organizations.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="nu-org">Organization</Label>
              <select id="nu-org" name="organizationId" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="">Match by email domain</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Roles</legend>
            <div className="grid grid-cols-2 gap-2">
              {roles.map((r) => (
                <label key={r.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.includes(r.key)}
                    onCheckedChange={(v) => setSelected((s) => (v ? [...s, r.key] : s.filter((k) => k !== r.key)))}
                  />
                  {r.name}
                </label>
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="submit" disabled={pending || selected.length === 0}>
              {pending ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
