"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

export function PasswordForm({ hasPassword, hint }: { hasPassword: boolean; hint: string }) {
  const [pending, setPending] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (f.get("newPassword") !== f.get("confirm")) {
      toast.error("New passwords don't match");
      return;
    }
    setPending(true);
    try {
      await api("/api/v1/me/password", { body: { currentPassword: f.get("currentPassword") || undefined, newPassword: f.get("newPassword") } });
      toast.success("Password changed");
      form.reset();
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
          <CardTitle className="text-base">{hasPassword ? "Change password" : "Set a password"}</CardTitle>
          <CardDescription>{hint}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasPassword && (
            <div className="space-y-2">
              <Label htmlFor="pw-current">Current password</Label>
              <Input id="pw-current" name="currentPassword" type="password" autoComplete="current-password" required />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="pw-new">New password</Label>
            <Input id="pw-new" name="newPassword" type="password" autoComplete="new-password" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pw-confirm">Confirm new password</Label>
            <Input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" required />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={pending}>
            Save password
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
