import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { configuredOidcProviders, signIn } from "@/server/auth";
import { getCurrentActor } from "@/server/session";
import { BrandMark } from "@/components/brand/brand-mark";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { safeCallbackUrl } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  AccessDenied: "Your account isn't allowed to sign in here. Contact the help desk if this is a mistake.",
  OAuthAccountNotLinked: "That email is already linked to another sign-in method.",
  Configuration: "Sign-in is misconfigured. Please contact an administrator.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; error?: string }> }) {
  const { callbackUrl: rawCallback, error } = await searchParams;
  const callbackUrl = safeCallbackUrl(rawCallback);
  if (await getCurrentActor()) redirect(callbackUrl);

  const cfg = getConfig();
  const oidc = configuredOidcProviders(cfg);

  return (
    <main id="main" className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <BrandMark size={40} className="text-lg" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>Use your work account or email and password.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && ERRORS[error] && (
              <Alert variant="destructive">
                <AlertDescription>{ERRORS[error]}</AlertDescription>
              </Alert>
            )}
            {oidc.map((p) => (
              <form
                key={p.id}
                action={async () => {
                  "use server";
                  await signIn(p.id, { redirectTo: callbackUrl });
                }}
              >
                <Button type="submit" variant="outline" className="w-full">
                  {p.label}
                </Button>
              </form>
            ))}
            {oidc.length > 0 && cfg.auth.local.enabled && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Separator className="flex-1" /> or <Separator className="flex-1" />
              </div>
            )}
            {cfg.auth.local.enabled && <LoginForm callbackUrl={callbackUrl} />}
          </CardContent>
        </Card>
        <p className="text-center text-sm text-muted-foreground">
          {cfg.features.publicSignup && (
            <>
              New here?{" "}
              <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
                Create an account
              </Link>
              {" · "}
            </>
          )}
          <Link href="/portal" className="underline-offset-4 hover:underline">
            Back to help center
          </Link>
        </p>
      </div>
    </main>
  );
}
