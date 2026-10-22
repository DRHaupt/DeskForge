"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { FieldInputs } from "@/components/tickets/field-inputs";
import { ItemIcon } from "@/components/item-icon";
import { RichTextEditor } from "@/components/tickets/rich-text-editor";
import { AttachmentUploader, type Uploaded } from "@/components/tickets/attachment-uploader";
import { api, ApiClientError } from "@/lib/api-client";
import type { TicketMeta } from "@/lib/ticket-meta";
import { cn } from "@/lib/utils";

const sel = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

export function PortalNewForm({ types, initialType, impact, urgency, suggest, assets }: { types: TicketMeta["types"]; initialType?: string; impact: TicketMeta["impact"]; urgency: TicketMeta["urgency"]; suggest: boolean; assets?: { id: string; label: string }[] }) {
  const router = useRouter();
  const [typeKey, setTypeKey] = useState(initialType ?? types[0]?.key ?? "");
  const type = types.find((t) => t.key === typeKey);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [articles, setArticles] = useState<{ slug: string; title: string }[]>([]);
  const [pending, setPending] = useState(false);
  const [deviceId, setDeviceId] = useState("");

  // Suggest articles while the requester types the subject.
  useEffect(() => {
    if (!suggest || title.trim().length < 4) {
      setArticles([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const text = `${title} ${description.replace(/<[^>]+>/g, " ")}`.slice(0, 200);
      fetch(`/api/v1/kb/suggest?q=${encodeURIComponent(text)}&limit=4`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { articles: [] }))
        .then((d) => setArticles(d.articles))
        .catch(() => undefined);
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [title, description, suggest]);

  if (!type) return <p className="mt-6 text-muted-foreground">There&apos;s nothing to submit here yet.</p>;
  const hasAssetField = type.fields.some((f) => f.type === "asset");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setErrors({});
    try {
      const res = await api<{ number: string }>("/api/v1/tickets", {
        body: {
          type: typeKey,
          title,
          description,
          impact: f.get("impact") || undefined,
          urgency: f.get("urgency") || undefined,
          fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== "" && v !== undefined)),
          attachmentIds: files.map((x) => x.id),
          assetIds: deviceId && !hasAssetField ? [deviceId] : [],
        },
      });
      toast.success("Thanks — we've got your request");
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
    <form onSubmit={onSubmit} className="mt-8 space-y-6">
      {types.length > 1 && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">What do you need?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {types.map((t) => (
              <label key={t.key} className={cn("cursor-pointer rounded-lg border p-3 hover:bg-accent/40", typeKey === t.key && "border-primary bg-primary/5 ring-1 ring-primary")}>
                <input type="radio" name="type" value={t.key} checked={typeKey === t.key} onChange={() => { setTypeKey(t.key); setFields({}); }} className="sr-only" />
                <span className="flex items-center gap-2 font-medium">
                  {t.icon && <ItemIcon name={t.icon} className="size-4 text-primary" />}
                  {t.name}
                </span>
                {t.description && <span className="text-sm text-muted-foreground">{t.description}</span>}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="pn-title">Subject</Label>
        <Input id="pn-title" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={200} placeholder="A short summary" aria-invalid={errors.title ? true : undefined} />
      </div>
      {articles.length > 0 && (
        <aside aria-live="polite" className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Lightbulb className="size-4 text-primary" aria-hidden /> These articles might answer your question:
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {articles.map((a) => (
              <li key={a.slug}>
                <Link href={`/portal/kb/${a.slug}`} target="_blank" className="text-primary hover:underline">
                  {a.title}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
      )}
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Details</p>
        <RichTextEditor value={description} onChange={setDescription} ariaLabel="Details" placeholder="What happened? What have you tried? Any error messages?" minHeight={160} />
        <AttachmentUploader files={files} onChange={setFiles} />
      </div>
      {type.fields.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldInputs fields={type.fields} values={fields} errors={errors} idPrefix="pf" onChange={(k, v) => setFields((s) => ({ ...s, [k]: v }))} assets={assets ?? []} />
        </div>
      )}
      {assets && assets.length > 0 && !hasAssetField && (
        <div className="space-y-1.5 sm:max-w-sm">
          <Label htmlFor="pn-device">Which of your devices is affected? (optional)</Label>
          <select id="pn-device" className={sel} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">None / not sure</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pn-impact">Who is affected?</Label>
          <select id="pn-impact" name="impact" className={sel} defaultValue="">
            <option value="">Not sure</option>
            {impact.map((x) => (
              <option key={x.key} value={x.key}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pn-urgency">How urgent is it?</Label>
          <select id="pn-urgency" name="urgency" className={sel} defaultValue="">
            <option value="">Not sure</option>
            {urgency.map((x) => (
              <option key={x.key} value={x.key}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? "Sending…" : "Submit request"}
        </Button>
      </div>
    </form>
  );
}
