"use client";

import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

export function DeleteAssetButton({ id, tag }: { id: string; tag: string }) {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      className="text-destructive"
      onClick={async () => {
        if (!confirm(`Delete ${tag}? Linked tickets keep their history.`)) return;
        try {
          await api(`/api/v1/assets/${id}`, { method: "DELETE" });
          router.push("/agent/assets");
          router.refresh();
        } catch (err) {
          toast.error((err as Error).message);
        }
      }}
    >
      Delete
    </Button>
  );
}

export function UnlinkButton({ assetId, relId, label }: { assetId: string; relId: string; label: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Unlink ${label}`}
      onClick={async () => {
        try {
          await api(`/api/v1/assets/${assetId}/links/${relId}`, { method: "DELETE" });
          router.refresh();
        } catch (err) {
          toast.error((err as Error).message);
        }
      }}
    >
      <X />
    </Button>
  );
}
