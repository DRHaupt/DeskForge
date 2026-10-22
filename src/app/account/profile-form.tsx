"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

export function ProfileForm({ user }: { user: { name: string; phone: string | null; jobTitle: string | null; notifyByEmail: boolean } }) {
  const router = useRouter();
  const [notify, setNotify] = useState(user.notifyByEmail);
  const [pending, setPending] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    try {
      await api("/api/v1/me", { method: "PATCH", body: { name: f.get("name"), phone: f.get("phone") || null, jobTitle: f.get("jobTitle") || null, notifyByEmail: notify } });
      toast.success("Profile saved");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile & notifications</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pf-name">Name</Label>
            <Input id="pf-name" name="name" defaultValue={user.name} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-phone">Phone</Label>
            <Input id="pf-phone" name="phone" defaultValue={user.phone ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-title">Job title</Label>
            <Input id="pf-title" name="jobTitle" defaultValue={user.jobTitle ?? ""} />
          </div>
          <label className="flex items-center gap-3 text-sm sm:col-span-2">
            <Switch checked={notify} onCheckedChange={setNotify} /> Email me about ticket updates (in-app notifications are always on)
          </label>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            Save profile
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
