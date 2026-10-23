import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CheckCircle2, ExternalLink, KeyRound, LogIn, ShieldCheck, Smartphone } from "lucide-react";
import { getConfig } from "@/core/config/loader";
import { BrandMark } from "@/components/brand/brand-mark";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { configuredOidcProviders, signIn, signOut } from "@/server/auth";
import { getCurrentActor } from "@/server/session";
import { homeFor, onboardingState } from "@/server/services/onboarding";
import { FinishButton } from "./finish-button";

export const metadata: Metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

const STEPS = [
  { key: "signin", label: "Sign in" },
  { key: "mfa", label: "Secure your account" },
  { key: "welcome", label: "Welcome" },
] as const;

function paragraphs(text: string) {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ email?: string; checked?: string }> }) {
  const cfg = getConfig();
  const o = cfg.onboarding;
  if (!o.enabled) notFound();
  const sp = await searchParams;
  const loginHint = sp.email && /^[^\s@]+@[^\s@]+$/.test(sp.email) ? sp.email.slice(0, 320) : undefined;
  const actor = await getCurrentActor();
  const state = await onboardingState(actor);
  const provider = o.provider ? configuredOidcProviders(cfg).find((p) => p.id === o.provider) : undefined;
  const stepIndex = STEPS.findIndex((s) => s.key === state.step);
  const steps = o.requireMfa ? STEPS : STEPS.filter((s) => s.key !== "mfa");

  async function signInWithProvider() {
    "use server";
    if (!provider) return;
    await signIn(provider.id, { redirectTo: "/welcome" }, loginHint ? { login_hint: loginHint } : undefined);
  }
  async function checkAgain() {
    "use server";
    if (!provider || !actor) return;
    // Without the Graph check, only a fresh sign-in can show that MFA was used.
    const params: Record<string, string> = { login_hint: actor.email };
    if (!o.checkRegisteredMethods) params.prompt = "login";
    await signIn(provider.id, { redirectTo: "/welcome?checked=1" }, params);
  }
  async function switchAccount() {
    "use server";
    await signOut({ redirectTo: `/welcome${loginHint ? `?email=${encodeURIComponent(loginHint)}` : ""}` });
  }

  return (
    <main id="main" className="flex min-h-screen items-start justify-center bg-muted/40 px-4 py-10 sm:items-center">
      <div className="w-full max-w-xl space-y-6">
        <div className="flex justify-center">
          <BrandMark size={40} className="text-lg" />
        </div>

        <ol className="flex items-center justify-center gap-2 text-sm" aria-label="Onboarding progress">
          {steps.map((s, i) => {
            const idx = STEPS.findIndex((x) => x.key === s.key);
            const done = idx < stepIndex;
            const current = idx === stepIndex;
            return (
              <li key={s.key} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
                {i > 0 && <span className="h-px w-6 bg-border sm:w-10" aria-hidden />}
                <span className={cn("flex size-6 items-center justify-center rounded-full border text-xs font-medium", done && "border-primary bg-primary text-primary-foreground", current && "border-primary text-primary")}>
                  {done ? <CheckCircle2 className="size-4" aria-label="done" /> : i + 1}
                </span>
                <span className={cn("hidden sm:inline", current ? "font-medium" : "text-muted-foreground")}>{s.label}</span>
              </li>
            );
          })}
        </ol>

        {state.step === "signin" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Welcome to {cfg.branding.name}</CardTitle>
              <CardDescription>Let&apos;s get your account ready. It takes about two minutes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <LogIn className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> Sign in with your {provider ? "work account" : "email and password"}.
                </li>
                {o.requireMfa && (
                  <li className="flex gap-2">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> Turn on multi-factor sign-in with an authenticator app on your phone.
                  </li>
                )}
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> Find out where to get help.
                </li>
              </ul>
              {provider ? (
                <form action={signInWithProvider}>
                  <Button type="submit" size="lg" className="w-full">
                    {provider.label}
                  </Button>
                </form>
              ) : o.provider ? (
                <Alert variant="destructive">
                  <AlertDescription>Single sign-on isn&apos;t configured on this server yet. Please contact IT.</AlertDescription>
                </Alert>
              ) : (
                <Button asChild size="lg" className="w-full">
                  <Link href="/login?callbackUrl=/welcome">Sign in</Link>
                </Button>
              )}
              {loginHint && <p className="text-center text-xs text-muted-foreground">Signing in as {loginHint}</p>}
            </CardContent>
          </Card>
        )}

        {state.step === "mfa" && actor && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Secure your account</CardTitle>
              <CardDescription>
                Hi {actor.name.split(" ")[0]}. Multi-factor sign-in protects your account even if someone learns your password.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {sp.checked && (
                <Alert>
                  <AlertDescription>
                    We couldn&apos;t confirm multi-factor sign-in yet. Make sure you finished adding the authenticator, then try again. If it keeps happening, contact IT.
                  </AlertDescription>
                </Alert>
              )}
              {state.method === "sso" ? (
                <>
                  <ol className="space-y-3 text-sm">
                    <li className="flex gap-3">
                      <Smartphone className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      <span>
                        Install <strong>Microsoft Authenticator</strong> on your phone from the App Store or Google Play.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      <span>
                        Open your security info page and choose <strong>Add sign-in method → Microsoft Authenticator</strong>. Follow the steps to scan the QR code.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      <span>Come back here and confirm. You&apos;ll sign in once more and approve the request on your phone.</span>
                    </li>
                  </ol>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button asChild variant="outline" className="flex-1">
                      <a href={o.mfaSetupUrl} target="_blank" rel="noopener noreferrer">
                        Open security info <ExternalLink />
                      </a>
                    </Button>
                    <form action={checkAgain} className="flex-1">
                      <Button type="submit" className="w-full">
                        I&apos;ve set it up, continue
                      </Button>
                    </form>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm">Set up an authenticator app for your help desk sign-in. You&apos;ll scan a QR code and enter a 6-digit code.</p>
                  <Button asChild className="w-full">
                    <Link href="/account/two-factor?next=/welcome">Set up two-factor sign-in</Link>
                  </Button>
                </>
              )}
              <form action={switchAccount} className="text-center">
                <button type="submit" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                  Not {actor.email}? Use a different account
                </button>
              </form>
            </CardContent>
          </Card>
        )}

        {state.step === "welcome" && actor && (
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">{o.welcome.title}</CardTitle>
              <CardDescription>
                {state.onboardedAt ? `Welcome back, ${actor.name.split(" ")[0]}.` : `Welcome, ${actor.name.split(" ")[0]}!`}
                {o.requireMfa && state.mfaVerifiedAt && (
                  <span className="mt-1 flex items-center gap-1.5 text-sm">
                    <ShieldCheck className="size-4 text-emerald-600" aria-hidden /> Multi-factor sign-in is on.
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {paragraphs(o.welcome.message).map((p, i) => (
                <p key={i} className="text-sm leading-relaxed">
                  {p}
                </p>
              ))}
              {o.welcome.links.length > 0 && (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {o.welcome.links.map((l) => (
                    <li key={l.label}>
                      <a href={l.url} className="block h-full rounded-lg border p-3 text-sm hover:border-primary/50 hover:bg-accent/40" {...(/^https?:/.test(l.url) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                        <span className="font-medium">{l.label}</span>
                        {l.description && <span className="mt-0.5 block text-muted-foreground">{l.description}</span>}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex justify-end">
                <FinishButton label={homeFor(actor) === "/agent" ? "Open the help desk" : "Go to the help center"} />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
