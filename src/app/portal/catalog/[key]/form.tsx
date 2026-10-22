"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FieldConfig } from "@/core/config/schema";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { FieldInputs } from "@/components/tickets/field-inputs";
import { AttachmentUploader, type Uploaded } from "@/components/tickets/attachment-uploader";
import { api, ApiClientError } from "@/lib/api-client";

export function CatalogForm({ itemKey, fields }: { itemKey: string; fields: FieldConfig[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const res = await api<{ number: string }>(`/api/v1/catalog/items/${itemKey}/request`, {
        body: { values: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== "" && v !== undefined)), notes: notes || undefined, attachmentIds: files.map((f) => f.id) },
      });
      toast.success("Request submitted");
      router.push(`/portal/tickets/${res.number}`);
    } catch (err) {
      if (err instanceof ApiClientError) {
        const fe = (err.data as { issues?: { fieldErrors?: Record<string, string[]> } })?.issues?.fieldErrors;
        if (fe) setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v.join(", ")])));
      }
      toast.error((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-5">
      <FieldInputs fields={fields} values={values} errors={errors} idPrefix="cat" onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))} />
      <div className="space-y-1.5">
        <Label htmlFor="cat-notes">Anything else we should know? (optional)</Label>
        <Textarea id="cat-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={10000} />
      </div>
      <AttachmentUploader files={files} onChange={setFiles} />
      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Submitting…" : "Submit request"}
        </Button>
      </div>
    </form>
  );
}
