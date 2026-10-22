"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";

export function DecideButtons({ id }: { id: string }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  async function decide(decision: "APPROVED" | "REJECTED") {
    setPending(true);
    try {
      await api(`/api/v1/approvals/${id}`, { body: { decision, comment: comment || undefined } });
      toast.success(decision === "APPROVED" ? "Approved" : "Rejected");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-2">
      <label htmlFor={`c-${id}`} className="sr-only">
        Comment
      </label>
      <Textarea id={`c-${id}`} placeholder="Comment (required when rejecting)" value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-14" />
      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => decide("APPROVED")}>
          Approve
        </Button>
        <Button variant="outline" disabled={pending || !comment.trim()} onClick={() => decide("REJECTED")}>
          Reject
        </Button>
      </div>
    </div>
  );
}
