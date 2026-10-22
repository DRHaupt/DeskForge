import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { describePolicy } from "@/core/auth/password";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Choose a password" };
export const dynamic = "force-dynamic";

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const cfg = getConfig();
  return (
    <AuthCard title="Choose a password">
      {token ? <ResetForm token={token} hint={describePolicy(cfg.auth.local.passwordPolicy)} /> : <p className="text-sm">This link is incomplete. Request a new one from the sign-in page.</p>}
    </AuthCard>
  );
}
