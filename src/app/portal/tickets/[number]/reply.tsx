"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { RichTextEditor } from "@/components/tickets/rich-text-editor";
import { AttachmentUploader, type Uploaded } from "@/components/tickets/attachment-uploader";
import { api } from "@/lib/api-client";

type T = { to: string; name: string; category: string; requireComment: boolean };

export function PortalReply({ ticketId, canReply, done, transitions, reopenOnReply, allowClose, closeStatus }: { ticketId: string; canReply: boolean; done: boolean; transitions: T[]; reopenOnReply: boolean; allowClose: boolean; closeStatus: string }) {
  const router = useRouter();
  const [html, setHtml] = useState("");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [pending, setPending] = useState(false);
  // Prefer portal.requesterCloseStatus; otherwise the first closing transition the requester may use.
  const close = allowClose ? (transitions.find((t) => t.to === closeStatus) ?? transitions.find((t) => t.category === "closed" || t.category === "resolved")) : undefined;
  const reopen = transitions.find((t) => t.category === "open" || t.category === "new");

  async function run(fn: () => Promise<unknown>, ok: string) {
    setPending(true);
    try {
      await fn();
      toast.success(ok);
      setHtml("");
      setFiles([]);
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  const empty = !html.replace(/<[^>]*>/g, "").trim();

  return (
    <section aria-label="Reply" className="mt-6 space-y-3">
      {canReply && (!done || reopenOnReply) && (
        <>
          <RichTextEditor value={html} onChange={setHtml} ariaLabel="Your reply" placeholder={done ? "Reply to reopen this request…" : "Add a reply…"} />
          <div className="flex flex-wrap items-center gap-2">
            <AttachmentUploader files={files} onChange={setFiles} disabled={pending} />
            <div className="ml-auto flex gap-2">
              {close && !done && (
                <Button
                  variant="outline"
                  disabled={pending || (close.requireComment && empty)}
                  onClick={() => {
                    if (!confirm("Mark this request as solved and close it?")) return;
                    void run(() => api(`/api/v1/tickets/${ticketId}/transition`, { body: { to: close.to, comment: empty ? undefined : html } }), "Request closed");
                  }}
                >
                  {empty ? "Close request" : "Reply & close"}
                </Button>
              )}
              <Button disabled={pending || (empty && !files.length)} onClick={() => run(() => api(`/api/v1/tickets/${ticketId}/comments`, { body: { body: html || "<p>(attachment)</p>", attachmentIds: files.map((f) => f.id) } }), "Reply sent")}>
                {pending ? "Sending…" : "Send reply"}
              </Button>
            </div>
          </div>
        </>
      )}
      {done && reopen && !reopenOnReply && (
        <Button variant="outline" disabled={pending} onClick={() => run(() => api(`/api/v1/tickets/${ticketId}/transition`, { body: { to: reopen.to } }), "Request reopened")}>
          Reopen request
        </Button>
      )}
    </section>
  );
}
