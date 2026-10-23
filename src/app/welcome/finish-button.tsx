"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

export function FinishButton({ label }: { label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="lg"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { next } = await api<{ next: string }>("/api/v1/me/onboarding", { method: "POST" });
          router.push(next);
          router.refresh();
        } catch (err) {
          toast.error((err as Error).message);
          setBusy(false);
        }
      }}
    >
      {label} <ArrowRight />
    </Button>
  );
}
