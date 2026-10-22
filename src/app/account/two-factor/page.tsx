import Link from "next/link";
import type { Metadata } from "next";
import { PortalShell } from "@/components/portal/portal-shell";
import { requireActor } from "@/server/session";
import { twoFactorStatus } from "@/server/services/two-factor";
import { TwoFactorSetup } from "./setup";

export const metadata: Metadata = { title: "Two-factor sign-in" };
export const dynamic = "force-dynamic";

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const actor = await requireActor("/account/two-factor", { allowTwoFactorSetup: true });
  const status = await twoFactorStatus(actor);
  const { required } = await searchParams;
  return (
    <PortalShell actor={actor}>
      <div className="mx-auto max-w-xl space-y-6 px-4 py-10">
        {!actor.mustEnrollTwoFactor && (
          <Link href="/account" className="text-sm text-muted-foreground hover:underline">
            ← Account
          </Link>
        )}
        <div>
          <h1 className="text-2xl font-semibold">Two-factor sign-in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            After your password, you&apos;ll enter a 6-digit code from an authenticator app (such as Microsoft Authenticator, Google Authenticator or 1Password).
          </p>
        </div>
        {required && actor.mustEnrollTwoFactor && (
          <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
            Your role needs two-factor sign-in. Set it up now to continue.
          </p>
        )}
        <TwoFactorSetup enabled={status.enabled} hasPassword={status.hasPassword} required={status.required} />
      </div>
    </PortalShell>
  );
}
