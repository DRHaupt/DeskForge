"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

type Props = {
  user: {
    id: string;
    name: string;
    email: string;
    jobTitle: string | null;
    phone: string | null;
    organizationId: string | null;
    orgTicketAccess: boolean;
    isActive: boolean;
    roleKeys: string[];
    totpEnabled: boolean;
    locked: boolean;
    isSelf: boolean;
  };
  roles: { key: string; name: string; description: string | null }[];
  organizations: { id: string; name: string }[];
  canEdit: boolean;
  passwordHint: string;
};

export function EditUserForm({ user, roles, organizations, canEdit, passwordHint }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [roleKeys, setRoleKeys] = useState(user.roleKeys);
  const [isActive, setIsActive] = useState(user.isActive);
  const [orgAccess, setOrgAccess] = useState(user.orgTicketAccess);

  async function save(body: Record<string, unknown>, message = "Saved") {
    setPending(true);
    try {
      await api(`/api/v1/users/${user.id}`, { method: "PATCH", body });
      toast.success(message);
      router.refresh();
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = f.get("password") as string;
    const ok = await save({
      name: f.get("name"),
      email: f.get("email"),
      jobTitle: (f.get("jobTitle") as string) || null,
      phone: (f.get("phone") as string) || null,
      organizationId: (f.get("organizationId") as string) || null,
      orgTicketAccess: orgAccess,
      roleKeys,
      isActive,
      ...(password ? { password } : {}),
    });
    if (ok) (e.target as HTMLFormElement).querySelector<HTMLInputElement>("input[name=password]")!.value = "";
  }

  return (
    <form onSubmit={onSubmit}>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile & access</CardTitle>
        </CardHeader>
        <CardContent>
          <fieldset disabled={!canEdit || pending} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="eu-name">Name</Label>
              <Input id="eu-name" name="name" defaultValue={user.name} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="eu-email">Email</Label>
              <Input id="eu-email" name="email" type="email" defaultValue={user.email} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="eu-title">Job title</Label>
              <Input id="eu-title" name="jobTitle" defaultValue={user.jobTitle ?? ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="eu-phone">Phone</Label>
              <Input id="eu-phone" name="phone" defaultValue={user.phone ?? ""} />
            </div>
            {organizations.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="eu-org">Organization</Label>
                <select id="eu-org" name="organizationId" defaultValue={user.organizationId ?? ""} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                  <option value="">None</option>
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="eu-password">Set new password</Label>
              <Input id="eu-password" name="password" type="password" autoComplete="new-password" aria-describedby="eu-password-hint" />
              <p id="eu-password-hint" className="text-xs text-muted-foreground">
                {passwordHint} Leave empty to keep the current one.
              </p>
            </div>
            <fieldset className="space-y-2 sm:col-span-2">
              <legend className="text-sm font-medium">Roles</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {roles.map((r) => (
                  <label key={r.key} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                    <Checkbox
                      className="mt-0.5"
                      checked={roleKeys.includes(r.key)}
                      onCheckedChange={(v) => setRoleKeys((s) => (v ? [...s, r.key] : s.filter((k) => k !== r.key)))}
                    />
                    <span>
                      <span className="font-medium">{r.name}</span>
                      {r.description && <span className="block text-xs text-muted-foreground">{r.description}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-3 text-sm sm:col-span-2">
              <Switch checked={orgAccess} onCheckedChange={setOrgAccess} />
              Can see all tickets from their organization in the portal
            </label>
            <label className="flex items-center gap-3 text-sm sm:col-span-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} disabled={user.isSelf} />
              Account active {user.isSelf && <span className="text-xs text-muted-foreground">(you can&apos;t deactivate yourself)</span>}
            </label>
          </fieldset>
        </CardContent>
        {canEdit && (
          <CardFooter className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending || roleKeys.length === 0}>
              Save changes
            </Button>
            {user.locked && (
              <Button type="button" variant="outline" disabled={pending} onClick={() => save({ unlock: true }, "Account unlocked")}>
                Unlock account
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                try {
                  await api(`/api/v1/users/${user.id}/invite`, { body: {} });
                  toast.success("Password setup link sent");
                } catch (err) {
                  toast.error((err as Error).message);
                } finally {
                  setPending(false);
                }
              }}
            >
              Email password setup link
            </Button>
            {user.totpEnabled && (
              <Button type="button" variant="outline" disabled={pending} onClick={() => save({ resetTwoFactor: true }, "Two-factor reset")}>
                Reset two-factor
              </Button>
            )}
          </CardFooter>
        )}
      </Card>
    </form>
  );
}
