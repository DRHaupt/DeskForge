"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

export function TwoFactorSetup({ enabled, hasPassword, required }: { enabled: boolean; hasPassword: boolean; required: boolean }) {
  const router = useRouter();
  const [enroll, setEnroll] = useState<{ secret: string; qrSvg: string; otpauthUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!hasPassword) {
    return <p className="text-sm text-muted-foreground">You sign in with single sign-on, so two-factor codes are handled by your organization&apos;s sign-in page.</p>;
  }

  if (enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-5 text-emerald-600" aria-hidden /> Two-factor sign-in is on
          </CardTitle>
          <CardDescription>{required ? "Your role requires it, so it can't be turned off. If you lose your phone, ask an administrator to reset it." : "You can turn it off with your password and a current code."}</CardDescription>
        </CardHeader>
        {!required && (
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                try {
                  await api("/api/v1/me/two-factor/disable", { body: { password: f.get("password"), code: f.get("code") } });
                  toast.success("Two-factor sign-in turned off");
                  router.refresh();
                } catch (err) {
                  toast.error((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="tf-pw">Password</Label>
                  <Input id="tf-pw" name="password" type="password" autoComplete="current-password" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tf-off-code">Current code</Label>
                  <Input id="tf-off-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required />
                </div>
              </div>
              <Button type="submit" variant="outline" disabled={busy}>
                Turn off
              </Button>
            </form>
          </CardContent>
        )}
      </Card>
    );
  }

  if (!enroll) {
    return (
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setEnroll(await api("/api/v1/me/two-factor", { method: "POST" }));
          } catch (err) {
            toast.error((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Set up two-factor sign-in
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">1. Scan this code with your authenticator app</CardTitle>
        <CardDescription>Can&apos;t scan? Add an account manually with this key (time-based):</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-6">
          {/* SVG produced on the server by the qrcode library from our own otpauth URL. */}
          <div role="img" aria-label="QR code for your authenticator app" className="size-44 rounded-md bg-white p-2" dangerouslySetInnerHTML={{ __html: enroll.qrSvg }} />
          <code className="break-all rounded bg-muted px-2 py-1 font-mono text-sm tracking-wider">{enroll.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
        </div>
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            try {
              await api("/api/v1/me/two-factor/confirm", { body: { code: new FormData(e.currentTarget).get("code") } });
              toast.success("Two-factor sign-in is on");
              router.push("/");
              router.refresh();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Label htmlFor="tf-code">2. Enter the 6-digit code it shows</Label>
          <div className="flex gap-2">
            <Input id="tf-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className="w-36 font-mono tracking-widest" aria-invalid={Boolean(error)} aria-describedby={error ? "tf-err" : undefined} />
            <Button type="submit" disabled={busy}>
              Turn on
            </Button>
          </div>
          {error && (
            <p id="tf-err" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
