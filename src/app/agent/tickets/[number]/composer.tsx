"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/tickets/rich-text-editor";
import { AttachmentUploader, type Uploaded } from "@/components/tickets/attachment-uploader";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { WorkspaceProps } from "./types";

type Mode = "PUBLIC" | "INTERNAL";

export function Composer({ ticket, perms, canned }: Pick<WorkspaceProps, "ticket" | "perms" | "canned">) {
  const router = useRouter();
  const editor = useRef<RichTextEditorHandle>(null);
  const [mode, setMode] = useState<Mode>(perms.reply ? "PUBLIC" : "INTERNAL");
  const [html, setHtml] = useState("");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  // r = reply, n = internal note (when not typing somewhere else)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "r" && perms.reply) {
        e.preventDefault();
        setMode("PUBLIC");
        editor.current?.focus();
      } else if (e.key === "n" && perms.internal) {
        e.preventDefault();
        setMode("INTERNAL");
        editor.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [perms.reply, perms.internal]);

  async function send() {
    const body = editor.current?.getHTML() ?? html;
    const empty = editor.current?.isEmpty() ?? !html;
    if (empty && !files.length && !status) return;
    setPending(true);
    try {
      if (status) {
        await api(`/api/v1/tickets/${ticket.id}/transition`, { body: { to: status, comment: empty ? undefined : body, commentVisibility: mode } });
        // Attachments can't ride on a transition; post them as a follow-up comment if any.
        if (files.length) await api(`/api/v1/tickets/${ticket.id}/comments`, { body: { body: "<p>Attachments</p>", visibility: mode, attachmentIds: files.map((f) => f.id) } });
      } else {
        await api(`/api/v1/tickets/${ticket.id}/comments`, { body: { body, visibility: mode, attachmentIds: files.map((f) => f.id) } });
      }
      editor.current?.clear();
      setHtml("");
      setFiles([]);
      setStatus("");
      toast.success(mode === "PUBLIC" ? "Reply sent" : "Note added");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (!perms.reply && !perms.internal) return null;

  return (
    <section aria-label="Reply" className={cn("rounded-lg border bg-card p-3", mode === "INTERNAL" && "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20")}>
      <div role="tablist" aria-label="Reply type" className="mb-2 flex gap-1">
        {perms.reply && (
          <button
            role="tab"
            type="button"
            aria-selected={mode === "PUBLIC"}
            onClick={() => setMode("PUBLIC")}
            className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", mode === "PUBLIC" ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
          >
            <MessageSquare className="size-4" /> Reply to requester <kbd className="ml-1 hidden text-[10px] opacity-70 sm:inline">r</kbd>
          </button>
        )}
        {perms.internal && (
          <button
            role="tab"
            type="button"
            aria-selected={mode === "INTERNAL"}
            onClick={() => setMode("INTERNAL")}
            className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", mode === "INTERNAL" ? "bg-amber-500 text-white" : "hover:bg-accent")}
          >
            <Lock className="size-4" /> Internal note <kbd className="ml-1 hidden text-[10px] opacity-70 sm:inline">n</kbd>
          </button>
        )}
        {canned.length > 0 && (
          <select
            aria-label="Insert canned response"
            className="ml-auto h-8 max-w-48 rounded-md border border-input bg-background px-2 text-sm"
            value=""
            onChange={(e) => {
              const c = canned.find((x) => x.id === e.target.value);
              if (c) setHtml((editor.current?.getHTML() ?? "") + c.body.replace(/\{\{\s*requester\.name\s*\}\}/g, ticket.requester.name.split(" ")[0]!).replace(/\{\{\s*ticket\.number\s*\}\}/g, ticket.number));
            }}
          >
            <option value="">Canned response…</option>
            {canned.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <div
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send();
          }
        }}
      >
        <RichTextEditor
          ref={editor}
          value={html}
          onChange={setHtml}
          mentions={perms.internal}
          ariaLabel={mode === "PUBLIC" ? "Reply to requester" : "Internal note"}
          placeholder={mode === "PUBLIC" ? `Reply to ${ticket.requester.name}…` : "Note for your team — type @ to mention someone"}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <AttachmentUploader files={files} onChange={setFiles} disabled={pending} />
        <div className="ml-auto flex items-center gap-2">
          {ticket.transitions.length > 0 && (
            <select aria-label="Also set status" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Keep status</option>
              {ticket.transitions.map((t) => (
                <option key={t.to} value={t.to}>
                  …and {t.name.toLowerCase()}
                </option>
              ))}
            </select>
          )}
          <Button onClick={send} disabled={pending} aria-keyshortcuts="Control+Enter Meta+Enter">
            <Send /> {pending ? "Sending…" : mode === "PUBLIC" ? "Send reply" : "Add note"}
          </Button>
        </div>
      </div>
    </section>
  );
}
