"use client";

import { useState } from "react";
import { Copy, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

export function WelcomeActions({ userId, link, onboarded }: { userId: string; link: string; onboarded: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        {onboarded ? "This person has finished onboarding. You can still resend the link." : "Send the welcome link: they sign in, set up multi-factor sign-in, then see your welcome page."}
      </p>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api(`/api/v1/users/${userId}/welcome`, { body: {} });
            toast.success("Welcome email sent");
          } catch (err) {
            toast.error((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Mail /> Send welcome email
      </Button>
      <div className="flex gap-2">
        <Input readOnly value={link} aria-label="Personal welcome link" className="text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Copy link"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              toast.success("Link copied");
            } catch {
              toast.error("Couldn't copy. Select the link and copy it manually.");
            }
          }}
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}
