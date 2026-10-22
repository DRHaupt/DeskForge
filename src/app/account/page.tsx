import Link from "next/link";
import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { describePolicy } from "@/core/auth/password";
import { PortalShell } from "@/components/portal/portal-shell";
import { requireActor } from "@/server/session";
import { db } from "@/server/db";
import { PasswordForm } from "./password-form";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const actor = await requireActor("/account");
  const cfg = getConfig();
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id }, select: { passwordHash: true, totpEnabled: true, name: true, phone: true, jobTitle: true, notifyByEmail: true } });
  return (
    <PortalShell actor={actor}>
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
        <div>
          <h1 className="text-2xl font-semibold">Account & security</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {actor.name} ({actor.email})
          </p>
        </div>
        <ProfileForm user={{ name: user.name, phone: user.phone, jobTitle: user.jobTitle, notifyByEmail: user.notifyByEmail }} />
        {cfg.auth.local.enabled && <PasswordForm hasPassword={Boolean(user.passwordHash)} hint={describePolicy(cfg.auth.local.passwordPolicy)} />}
        {user.passwordHash && (
          <div className="flex items-center justify-between rounded-xl border p-4">
            <div>
              <p className="font-medium">Two-factor sign-in</p>
              <p className="text-sm text-muted-foreground">{user.totpEnabled ? "On — you'll be asked for a code from your authenticator app." : "Off — add a code from your phone to protect your account."}</p>
            </div>
            <Link href="/account/two-factor" className="text-sm font-medium text-primary hover:underline">
              {user.totpEnabled ? "Manage" : "Set up"}
            </Link>
          </div>
        )}
      </div>
    </PortalShell>
  );
}
