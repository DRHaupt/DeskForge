"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const MESSAGES: Record<string, string> = {
  invalid_credentials: "That email and password don't match.",
  locked: "Too many failed attempts. Try again later.",
  otp_invalid: "That code isn't right. Check your authenticator app and try again.",
  rate_limited: "Too many sign-in attempts. Wait a minute and try again.",
};

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [needOtp, setNeedOtp] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const otp = form.get("otp");
    const res = await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      // Only send a code when the field is shown; undefined would be posted as the text "undefined".
      ...(otp ? { otp } : {}),
      redirect: false,
    });
    setPending(false);
    if (res?.error) {
      if (res.code === "otp_required") {
        setNeedOtp(true);
        return;
      }
      setError(MESSAGES[res.code ?? ""] ?? MESSAGES.invalid_credentials!);
      return;
    }
    router.replace(callbackUrl);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {needOtp && (
        <div className="space-y-2">
          <Label htmlFor="otp">Authentication code</Label>
          <Input id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus aria-describedby="otp-help" />
          <p id="otp-help" className="text-xs text-muted-foreground">
            Enter the 6-digit code from your authenticator app.
          </p>
        </div>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm">
        <a href="/forgot-password" className="text-muted-foreground underline-offset-4 hover:underline">
          Forgot your password?
        </a>
      </p>
    </form>
  );
}
