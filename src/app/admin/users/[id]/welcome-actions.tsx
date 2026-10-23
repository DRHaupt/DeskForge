"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

export function WelcomeActions({ userId, link, onboarded }: { userId: string; link: string; onboarded: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        {onboarded ? "This person has finished onboarding. You can still resend the link." : "Send the welcome link: they sign in, set up multi-factor sign-in, then see your welcome page."}
      </p>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api(`/api/v1/users/${userId}/welcome`, { body: {} });
            toast.success("Welcome email queued");
            router.refresh();
          } catch (err) {
            toast.error((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Mail /> Send welcome email
      </Button>
      <div className="flex gap-2">
        <Input readOnly value={link} aria-label="Personal welcome link" className="text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Copy link"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              toast.success("Link copied");
            } catch {
              toast.error("Couldn't copy. Select the link and copy it manually.");
            }
          }}
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}

/** Email the temporary password from Entra. The password goes straight into the email and isn't stored. */
export function SignInDetailsForm({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!password.trim()) return;
        setBusy(true);
        try {
          await api(`/api/v1/users/${userId}/signin-details`, { body: { temporaryPassword: password } });
          setPassword("");
          toast.success(`Sign-in details sent to ${email}`);
          router.refresh();
        } catch (err) {
          toast.error((err as Error).message);
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-muted-foreground">
        Paste the temporary password Entra showed when you created this account. It&apos;s emailed with their username to {email} and isn&apos;t saved anywhere.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="temp-password">Temporary password</Label>
        <Input id="temp-password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={256} />
      </div>
      <Button type="submit" variant="outline" className="w-full" disabled={busy || !password.trim()}>
        <KeyRound /> Send sign-in details
      </Button>
    </form>
  );
}
