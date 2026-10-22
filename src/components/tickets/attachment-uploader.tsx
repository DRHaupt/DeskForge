"use client";

import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

export type Uploaded = { id: string; filename: string; size: number };

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentUploader({ files, onChange, disabled }: { files: Uploaded[]; onChange: (f: Uploaded[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    const added: Uploaded[] = [];
    for (const file of Array.from(list)) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/v1/attachments", { method: "POST", body: form, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(`${file.name}: ${data.error ?? "upload failed"}`);
      else added.push(data);
    }
    onChange([...files, ...added]);
    setBusy(false);
    if (input.current) input.current.value = "";
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={input} type="file" multiple className="sr-only" id="attach-input" onChange={(e) => upload(e.target.files)} disabled={disabled || busy} />
      <Button type="button" variant="ghost" size="sm" onClick={() => input.current?.click()} disabled={disabled || busy}>
        <Paperclip /> {busy ? "Uploading…" : "Attach"}
      </Button>
      {files.map((f) => (
        <span key={f.id} className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-0.5 text-xs">
          {f.filename} <span className="text-muted-foreground">({formatBytes(f.size)})</span>
          <button type="button" aria-label={`Remove ${f.filename}`} onClick={() => onChange(files.filter((x) => x.id !== f.id))} className="rounded hover:bg-accent">
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
