"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api } from "@/lib/api-client";

export function SignupForm({ hint }: { hint: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api("/api/v1/public/signup", { body: { name: f.get("name"), email: f.get("email"), password: f.get("password") } });
      await signIn("credentials", { email: f.get("email"), password: f.get("password"), redirect: false });
      router.replace("/portal");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="su-name">Name</Label>
        <Input id="su-name" name="name" autoComplete="name" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="su-email">Email</Label>
        <Input id="su-email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="su-password">Password</Label>
        <Input id="su-password" name="password" type="password" autoComplete="new-password" required aria-describedby="su-hint" />
        <p id="su-hint" className="text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}

export function ForgotForm() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  if (sent) return <p className="text-sm" role="status">If an account exists for that email, we&apos;ve sent a link to reset the password. It works for one hour.</p>;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        await api("/api/v1/public/password-reset", { body: { email: new FormData(e.currentTarget).get("email") } }).catch(() => undefined);
        setSent(true);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="fp-email">Email</Label>
        <Input id="fp-email" name="email" type="email" autoComplete="email" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        Send reset link
      </Button>
    </form>
  );
}

export function ResetForm({ token, hint }: { token: string; hint: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (f.get("password") !== f.get("confirm")) {
          setError("Passwords don't match");
          return;
        }
        setPending(true);
        setError(null);
        try {
          const res = await api<{ email: string }>("/api/v1/public/password-reset/confirm", { body: { token, password: f.get("password") } });
          await signIn("credentials", { email: res.email, password: f.get("password"), redirect: false });
          router.replace("/");
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
          setPending(false);
        }
      }}
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="rp-password">New password</Label>
        <Input id="rp-password" name="password" type="password" autoComplete="new-password" required aria-describedby="rp-hint" />
        <p id="rp-hint" className="text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="rp-confirm">Confirm password</Label>
        <Input id="rp-confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        Save password and sign in
      </Button>
    </form>
  );
}
