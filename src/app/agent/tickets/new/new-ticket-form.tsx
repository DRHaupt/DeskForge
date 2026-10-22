"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { FieldInputs } from "@/components/tickets/field-inputs";
import { RichTextEditor } from "@/components/tickets/rich-text-editor";
import { AttachmentUploader, type Uploaded } from "@/components/tickets/attachment-uploader";
import { api, ApiClientError } from "@/lib/api-client";
import type { TicketMeta } from "@/lib/ticket-meta";

const sel = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
type Person = { id: string; name: string; email: string; organization?: { name: string } | null };

export function NewTicketForm({
  meta,
  initialType,
  parent,
  canOnBehalf,
  me,
  teams,
  agents,
  categories,
  assets,
}: {
  meta: TicketMeta;
  initialType?: string;
  parent?: string;
  canOnBehalf: boolean;
  me: { id: string; name: string; email: string };
  teams: { id: string; name: string }[];
  agents: { id: string; name: string; teamIds: string[] }[];
  categories: { id: string; label: string }[];
  assets: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [typeKey, setTypeKey] = useState(initialType && meta.types.some((t) => t.key === initialType) ? initialType : meta.types[0]!.key);
  const type = meta.types.find((t) => t.key === typeKey)!;
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [requester, setRequester] = useState<Person>({ ...me });
  const [newEmail, setNewEmail] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [teamId, setTeamId] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!canOnBehalf || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<Person[]>(`/api/v1/lookup/users?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then(setResults)
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, canOnBehalf]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setErrors({});
    try {
      const body: Record<string, unknown> = {
        type: typeKey,
        title: f.get("title"),
        description,
        fields: Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== "" && v !== undefined)),
        attachmentIds: files.map((x) => x.id),
        impact: f.get("impact") || undefined,
        urgency: f.get("urgency") || undefined,
        priority: f.get("priority") || undefined,
        categoryId: f.get("categoryId") || undefined,
        teamId: teamId || undefined,
        assigneeId: f.get("assigneeId") || undefined,
        tags: String(f.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
      };
      if (newEmail) {
        body.requesterEmail = newEmail;
        body.requesterName = f.get("requesterName") || undefined;
      } else if (requester.id !== me.id) body.requesterId = requester.id;
      const res = await api<{ id: string; number: string }>("/api/v1/tickets", { body });
      if (parent) await api(`/api/v1/tickets/${parent}/links`, { body: { type: "PARENT_CHILD", target: res.number } }).catch(() => undefined);
      toast.success(`Created ${res.number}`);
      router.push(`/agent/tickets/${res.number}`);
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
    <form onSubmit={onSubmit}>
      <Card>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="nt-type">Type</Label>
              <select id="nt-type" className={sel} value={typeKey} onChange={(e) => { setTypeKey(e.target.value); setFields({}); }}>
                {meta.types.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </select>
              {type.description && <p className="text-xs text-muted-foreground">{type.description}</p>}
            </div>
            <div className="relative space-y-1.5">
              <Label htmlFor="nt-requester">Requester</Label>
              {canOnBehalf ? (
                <>
                  <Input
                    id="nt-requester"
                    role="combobox"
                    aria-expanded={results.length > 0}
                    aria-controls="nt-requester-list"
                    autoComplete="off"
                    value={query || (newEmail ? newEmail : `${requester.name} <${requester.email}>`)}
                    onFocus={() => setQuery("")}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name or email"
                  />
                  {(results.length > 0 || /\S+@\S+\.\S+/.test(query)) && query && (
                    <ul id="nt-requester-list" role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
                      {results.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={false}
                            className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                            onClick={() => {
                              setRequester(r);
                              setNewEmail(null);
                              setQuery("");
                              setResults([]);
                            }}
                          >
                            {r.name} <span className="text-xs text-muted-foreground">{r.email}{r.organization ? ` · ${r.organization.name}` : ""}</span>
                          </button>
                        </li>
                      ))}
                      {/\S+@\S+\.\S+/.test(query) && !results.some((r) => r.email === query.toLowerCase()) && (
                        <li>
                          <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { setNewEmail(query.trim().toLowerCase()); setQuery(""); setResults([]); }}>
                            New requester: <strong>{query}</strong>
                          </button>
                        </li>
                      )}
                    </ul>
                  )}
                </>
              ) : (
                <Input id="nt-requester" value={`${me.name} <${me.email}>`} disabled />
              )}
            </div>
            {newEmail && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="nt-reqname">New requester&apos;s name</Label>
                <Input id="nt-reqname" name="requesterName" placeholder="Full name" />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nt-title">Subject</Label>
            <Input id="nt-title" name="title" required minLength={3} maxLength={200} aria-invalid={errors.title ? true : undefined} />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Description</p>
            <RichTextEditor value={description} onChange={setDescription} ariaLabel="Description" placeholder="What happened? What did you expect?" minHeight={160} />
            <AttachmentUploader files={files} onChange={setFiles} />
          </div>

          {type.fields.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldInputs fields={type.fields} values={fields} errors={errors} idPrefix="nf" onChange={(k, v) => setFields((s) => ({ ...s, [k]: v }))} assets={assets.length ? assets : undefined} agents={agents} />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="nt-impact">Impact</Label>
              <select id="nt-impact" name="impact" className={sel}>
                <option value="">—</option>
                {meta.impact.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nt-urgency">Urgency</Label>
              <select id="nt-urgency" name="urgency" className={sel}>
                <option value="">—</option>
                {meta.urgency.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nt-priority">Priority (override)</Label>
              <select id="nt-priority" name="priority" className={sel}>
                <option value="">From impact × urgency</option>
                {meta.priorities.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nt-team">Team</Label>
              <select id="nt-team" className={sel} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">Type default</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nt-assignee">Assignee</Label>
              <select id="nt-assignee" name="assigneeId" className={sel}>
                <option value="">Automatic</option>
                {(teamId ? agents.filter((a) => a.teamIds.includes(teamId)) : agents).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nt-category">Category</Label>
              <select id="nt-category" name="categoryId" className={sel}>
                <option value="">None</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nt-tags">Tags</Label>
            <Input id="nt-tags" name="tags" placeholder="comma, separated" />
          </div>
          {parent && <p className="text-sm text-muted-foreground">Will be linked as a child of {parent}.</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create ticket"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
