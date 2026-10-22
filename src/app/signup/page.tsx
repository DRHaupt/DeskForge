import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getConfig } from "@/core/config/loader";
import { describePolicy } from "@/core/auth/password";
import { AuthCard } from "@/components/auth/auth-card";
import { SignupForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Create an account" };
export const dynamic = "force-dynamic";

export default function SignupPage() {
  const cfg = getConfig();
  if (!cfg.features.publicSignup || !cfg.auth.local.enabled) notFound();
  return (
    <AuthCard title="Create an account" description={`Track your requests with ${cfg.branding.name}.`} footer={<>Already have an account? <Link href="/login" className="font-medium text-primary hover:underline">Sign in</Link></>}>
      <SignupForm hint={describePolicy(cfg.auth.local.passwordPolicy)} />
    </AuthCard>
  );
}
