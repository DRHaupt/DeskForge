"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

async function copy(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Couldn't copy. Select the text and copy it manually.");
  }
}

export function CopyField({ label, value }: { label: string; value: string }) {
  const id = `copy-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="ghost" size="icon" aria-label={`Copy ${label}`} onClick={() => copy(value, label)}>
          <Copy />
        </Button>
      </div>
    </div>
  );
}

export function TokenActions({ hasToken }: { hasToken: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  async function generate() {
    if (hasToken && !confirm("Replace the current token? Provisioning stops until you paste the new token into Entra.")) return;
    setBusy(true);
    try {
      const res = await api<{ token: string }>("/api/v1/provisioning/token", { method: "POST" });
      setToken(res.token);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirm("Revoke the token? Your identity provider will no longer be able to create or update accounts.")) return;
    setBusy(true);
    try {
      await api("/api/v1/provisioning/token", { method: "DELETE" });
      toast.success("Token revoked");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={generate} disabled={busy}>
          {hasToken ? "Generate new token" : "Generate token"}
        </Button>
        {hasToken && (
          <Button type="button" variant="outline" onClick={revoke} disabled={busy}>
            Revoke
          </Button>
        )}
      </div>
      <Dialog open={!!token} onOpenChange={(o) => !o && setToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Provisioning token</DialogTitle>
            <DialogDescription>Copy it now and paste it into Secret Token in Entra. It can&apos;t be shown again.</DialogDescription>
          </DialogHeader>
          <code className="block rounded bg-muted p-3 text-sm break-all select-all">{token}</code>
          <Button type="button" variant="outline" onClick={() => token && copy(token, "Token")}>
            <Copy /> Copy token
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
