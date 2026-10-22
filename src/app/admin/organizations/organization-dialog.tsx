"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

type Org = { id: string; name: string; slug: string; domains: string[]; phone: string | null; notes: string | null; isActive: boolean };

export function OrganizationDialog({ org }: { org?: Org }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [isActive, setIsActive] = useState(org?.isActive ?? true);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get("name"),
      slug: f.get("slug"),
      domains: String(f.get("domains") ?? "")
        .split(/[\s,]+/)
        .filter(Boolean),
      phone: f.get("phone") || null,
      notes: f.get("notes") || null,
      isActive,
    };
    setPending(true);
    try {
      await api(org ? `/api/v1/organizations/${org.id}` : "/api/v1/organizations", { method: org ? "PATCH" : "POST", body });
      toast.success(org ? "Organization saved" : "Organization created");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {org ? (
          <Button variant="ghost" size="sm" aria-label={`Edit ${org.name}`}>
            Edit
          </Button>
        ) : (
          <Button>
            <PlusIcon /> New organization
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{org ? `Edit ${org.name}` : "New organization"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Name</Label>
            <Input id="org-name" name="name" defaultValue={org?.name} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-slug">Slug</Label>
            <Input id="org-slug" name="slug" defaultValue={org?.slug} required pattern="[a-z][a-z0-9_-]{1,40}" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-domains">Email domains</Label>
            <Input id="org-domains" name="domains" defaultValue={org?.domains.join(", ")} placeholder="example.com, example.org" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-phone">Phone</Label>
            <Input id="org-phone" name="phone" defaultValue={org?.phone ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-notes">Notes (agents only)</Label>
            <Textarea id="org-notes" name="notes" defaultValue={org?.notes ?? ""} />
          </div>
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={isActive} onCheckedChange={setIsActive} /> Active
          </label>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
