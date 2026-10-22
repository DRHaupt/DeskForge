import Link from "next/link";
import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <AuthCard title="Reset your password" description="We'll email you a link to choose a new one." footer={<Link href="/login" className="hover:underline">Back to sign in</Link>}>
      <ForgotForm />
    </AuthCard>
  );
}
