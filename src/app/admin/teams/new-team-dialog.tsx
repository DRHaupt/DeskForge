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

export function NewTeamDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    try {
      const res = await api<{ id: string }>("/api/v1/teams", {
        body: { key: f.get("key"), name: f.get("name"), email: f.get("email") || null, assignmentStrategy: f.get("assignmentStrategy") },
      });
      toast.success("Team created");
      router.push(`/admin/teams/${res.id}`);
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
          <PlusIcon /> New team
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription>Add members after creating the team.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nt-name">Name</Label>
            <Input id="nt-name" name="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nt-key">Key</Label>
            <Input id="nt-key" name="key" required pattern="[a-z][a-z0-9_-]{1,40}" placeholder="e.g. service_desk" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nt-email">Team email (optional)</Label>
            <Input id="nt-email" name="email" type="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nt-strategy">Assignment</Label>
            <select id="nt-strategy" name="assignmentStrategy" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" defaultValue="MANUAL">
              <option value="MANUAL">Manual</option>
              <option value="ROUND_ROBIN">Round-robin</option>
              <option value="LOAD_BALANCED">Load-balanced (fewest open tickets)</option>
            </select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Create team
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
