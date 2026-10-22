"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Trash2, Eye, EyeOff, GitMerge, Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { PriorityBadge, StatusBadge } from "@/components/tickets/badges";
import { FieldInputs } from "@/components/tickets/field-inputs";
import { RichTextEditor } from "@/components/tickets/rich-text-editor";
import { SlaBadge } from "@/components/tickets/sla-badge";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { stateColor, stateLabel } from "@/lib/ticket-meta";
import { Composer } from "./composer";
import { SlaCard } from "./sla-card";
import { Timeline } from "./timeline";
import type { WorkspaceProps } from "./types";

const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60";
const LINK_LABELS: Record<string, [string, string]> = {
  PARENT_CHILD: ["Child", "Parent"],
  DUPLICATE_OF: ["Duplicate of", "Duplicated by"],
  RELATED: ["Related to", "Related to"],
  CAUSED_BY: ["Caused by", "Causes"],
  BLOCKS: ["Blocks", "Blocked by"],
  AFFECTS_ASSET: ["Affects asset", "Affects asset"],
};

export function TicketWorkspace(props: WorkspaceProps) {
  const { ticket, timeline, meta, perms, me } = props;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [transition, setTransition] = useState<WorkspaceProps["ticket"]["transitions"][number] | null>(null);
  const [editTitle, setEditTitle] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const typeMeta = meta.types.find((t) => t.key === ticket.type.key);
  const pr = meta.priorities.find((p) => p.key === ticket.priority);
  const watching = ticket.watchers?.some((w) => w.userId === me.id) ?? false;

  async function call(url: string, body?: unknown, method?: string, okMsg = "Saved") {
    setBusy(true);
    try {
      const res = await api(url, { body, method });
      toast.success(okMsg);
      router.refresh();
      return res;
    } catch (err) {
      toast.error((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const doTransition = (to: string, comment?: string, commentVisibility?: string) =>
    call(`/api/v1/tickets/${ticket.id}/transition`, { to, comment, commentVisibility }, "POST", "Status updated");

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        <div>
          <p className="mb-2 text-sm">
            <Link href="/agent/tickets" className="text-muted-foreground hover:underline">
              ← Tickets
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono">{ticket.number}</span>
            <span>·</span>
            <span>{ticket.type.name}</span>
            <StatusBadge label={stateLabel(meta, ticket.type.key, ticket.status)} color={stateColor(meta, ticket.type.key, ticket.status)} category={ticket.statusCategory} />
            <PriorityBadge label={pr?.name ?? ticket.priority} color={pr?.color} />
            <SlaBadge sla={ticket.sla} />
            {ticket.mergedInto && (
              <Link href={`/agent/tickets/${ticket.mergedInto.number}`} className="text-primary hover:underline">
                Merged into {ticket.mergedInto.number}
              </Link>
            )}
          </div>
          <div className="mt-2 flex items-start gap-2">
            {editTitle ? (
              <form
                className="flex flex-1 gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const title = new FormData(e.currentTarget).get("title");
                  if (await call(`/api/v1/tickets/${ticket.id}`, { title }, "PATCH")) setEditTitle(false);
                }}
              >
                <Input name="title" defaultValue={ticket.title} aria-label="Title" autoFocus className="text-lg font-semibold" />
                <Button type="submit" disabled={busy}>
                  Save
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEditTitle(false)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <h1 className="flex-1 text-2xl font-semibold tracking-tight">{ticket.title}</h1>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {perms.update && (
                  <DropdownMenuItem onSelect={() => setEditTitle(true)}>
                    <Pencil /> Edit title
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => call(`/api/v1/tickets/${ticket.id}/watchers`, watching ? { remove: [me.id] } : { add: [me.id] }, "POST", watching ? "Stopped watching" : "Watching")}>
                  {watching ? <EyeOff /> : <Eye />} {watching ? "Stop watching" : "Watch"}
                </DropdownMenuItem>
                {perms.link && (
                  <>
                    <DropdownMenuItem onSelect={() => setLinkOpen(true)}>
                      <Link2 /> Link ticket…
                    </DropdownMenuItem>
                    {!ticket.mergedInto && (
                      <DropdownMenuItem onSelect={() => setMergeOpen(true)}>
                        <GitMerge /> Merge into…
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                {perms.delete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={async () => {
                        if (!confirm(`Delete ${ticket.number}? It can be restored from the database by an administrator.`)) return;
                        if (await call(`/api/v1/tickets/${ticket.id}`, undefined, "DELETE", "Ticket deleted")) router.push("/agent/tickets");
                      }}
                    >
                      <Trash2 /> Delete ticket
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {ticket.transitions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Change status">
              {ticket.transitions.map((t) => (
                <Button
                  key={t.to}
                  size="sm"
                  variant={t.category === "resolved" ? "default" : "outline"}
                  disabled={busy}
                  onClick={() => (t.requireComment ? setTransition(t) : doTransition(t.to))}
                >
                  {t.name}
                </Button>
              ))}
            </div>
          )}
        </div>

        <Card>
          <CardContent>
            <div className="mb-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{ticket.requester.name}</span> opened this {formatDateTime(ticket.createdAt, meta.timezone)} via {ticket.source.toLowerCase()}
            </div>
            {ticket.description ? <div className="prose-df" dangerouslySetInnerHTML={{ __html: ticket.description }} /> : <p className="text-sm text-muted-foreground">No description.</p>}
          </CardContent>
        </Card>

        <Timeline items={timeline} meta={meta} typeKey={ticket.type.key} />
        <Composer ticket={ticket} perms={perms} canned={props.canned} />
      </div>

      <aside aria-label="Ticket properties" className="space-y-4">
        <SlaCard ticket={ticket} timezone={meta.timezone} canOverride={perms.slaOverride} call={call} />
        <Properties {...props} busy={busy} call={call} />
        <Links {...props} call={call} onAdd={() => setLinkOpen(true)} />
      </aside>

      <TransitionDialog transition={transition} onClose={() => setTransition(null)} canInternal={perms.internal} onSubmit={async (comment, vis) => { if (await doTransition(transition!.to, comment, vis)) setTransition(null); }} />
      <LinkDialog open={linkOpen} onOpenChange={setLinkOpen} assets={props.features.assets ? props.assets : []} onSubmit={async (body) => { if (await call(`/api/v1/tickets/${ticket.id}/links`, body, "POST", "Linked")) setLinkOpen(false); }} />
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge {ticket.number} into another ticket</DialogTitle>
            <DialogDescription>Comments and attachments move to the other ticket, the requester becomes a watcher there, and this ticket is closed.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const target = String(new FormData(e.currentTarget).get("target")).trim().toUpperCase();
              const res = (await call(`/api/v1/tickets/${ticket.id}/merge`, { target }, "POST", "Merged")) as { number: string } | null;
              if (res) {
                setMergeOpen(false);
                router.push(`/agent/tickets/${res.number}`);
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="merge-target">Ticket number to merge into</Label>
              <Input id="merge-target" name="target" placeholder="e.g. INC0001042" required />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                Merge
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TransitionDialog({ transition, onClose, onSubmit, canInternal }: { transition: { to: string; name: string } | null; onClose: () => void; onSubmit: (comment: string, visibility: string) => void; canInternal: boolean }) {
  const [html, setHtml] = useState("");
  const [vis, setVis] = useState("PUBLIC");
  return (
    <Dialog open={!!transition} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{transition?.name}</DialogTitle>
          <DialogDescription>A comment is required for this change.</DialogDescription>
        </DialogHeader>
        <RichTextEditor value={html} onChange={setHtml} ariaLabel="Comment" placeholder="Explain what was done…" />
        {canInternal && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={vis === "INTERNAL"} onChange={(e) => setVis(e.target.checked ? "INTERNAL" : "PUBLIC")} /> Internal note (not visible to the requester)
          </label>
        )}
        <DialogFooter>
          <Button onClick={() => onSubmit(html, vis)}>{transition?.name}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkDialog({ open, onOpenChange, onSubmit, assets }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (b: Record<string, string>) => void; assets: { id: string; label: string }[] }) {
  const [type, setType] = useState("RELATED");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            onSubmit(type === "AFFECTS_ASSET" ? { type, assetId: String(f.get("assetId")) } : { type, target: String(f.get("target")).trim().toUpperCase() });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="link-type">This ticket…</Label>
            <select id="link-type" className={sel} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="RELATED">is related to</option>
              <option value="PARENT_CHILD">is the parent of</option>
              <option value="DUPLICATE_OF">is a duplicate of</option>
              <option value="CAUSED_BY">is caused by (problem)</option>
              <option value="BLOCKS">blocks</option>
              {assets.length > 0 && <option value="AFFECTS_ASSET">affects asset</option>}
            </select>
          </div>
          {type === "AFFECTS_ASSET" ? (
            <div className="space-y-2">
              <Label htmlFor="link-asset">Asset</Label>
              <select id="link-asset" name="assetId" className={sel} required>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="link-target">Ticket number</Label>
              <Input id="link-target" name="target" placeholder="e.g. PRB0000012" required />
            </div>
          )}
          <DialogFooter>
            <Button type="submit">Add link</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Links({ ticket, perms, call, onAdd }: WorkspaceProps & { call: (url: string, body?: unknown, method?: string, ok?: string) => Promise<unknown>; onAdd: () => void }) {
  if (!ticket.links.length && !perms.link) return null;
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4">
        <CardTitle className="text-sm">Links</CardTitle>
        {perms.link && (
          <Button variant="ghost" size="sm" onClick={onAdd}>
            Add
          </Button>
        )}
      </CardHeader>
      <CardContent className="px-4">
        {ticket.links.length === 0 && <p className="text-sm text-muted-foreground">No linked tickets.</p>}
        <ul className="space-y-1.5 text-sm">
          {ticket.links.map((l) => (
            <li key={l.id} className="flex items-start gap-2">
              <span className="w-24 shrink-0 text-xs text-muted-foreground">{LINK_LABELS[l.type]?.[l.direction === "outgoing" ? 0 : 1] ?? l.type}</span>
              {l.ticket ? (
                <Link href={`/agent/tickets/${l.ticket.number}`} className="min-w-0 flex-1 truncate hover:underline">
                  <span className="font-mono text-xs">{l.ticket.number}</span> {l.ticket.title}
                </Link>
              ) : (
                <span className="flex-1 truncate">{l.asset ? `${l.asset.tag} · ${l.asset.name}` : "—"}</span>
              )}
              {perms.link && (
                <button aria-label="Remove link" className="rounded p-0.5 text-muted-foreground hover:bg-accent" onClick={() => call(`/api/v1/tickets/${ticket.id}/links/${l.id}`, undefined, "DELETE", "Link removed")}>
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function Properties({ ticket, meta, perms, teams, agents, categories, assets, me, features, busy, call }: WorkspaceProps & { busy: boolean; call: (url: string, body?: unknown, method?: string, ok?: string) => Promise<unknown> }) {
  const typeMeta = meta.types.find((t) => t.key === ticket.type.key);
  const [fields, setFields] = useState<Record<string, unknown>>(ticket.fields);
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const canAssign = perms.assign || perms.reassign;
  const teamAgents = ticket.team ? agents.filter((a) => a.teamIds.includes(ticket.team!.id)) : agents;
  const patch = (body: Record<string, unknown>) => call(`/api/v1/tickets/${ticket.id}`, body, "PATCH");
  const assign = (body: Record<string, unknown>) => call(`/api/v1/tickets/${ticket.id}/assign`, body, "POST", "Assignment updated");

  return (
    <>
      <Card className="gap-3 py-4">
        <CardContent className="space-y-3 px-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Requester</p>
            <p className="font-medium">{ticket.requester.name}</p>
            <p className="text-xs text-muted-foreground">
              <a href={`mailto:${ticket.requester.email}`} className="hover:underline">
                {ticket.requester.email}
              </a>
              {ticket.organization && ` · ${ticket.organization.name}`}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-team" className="text-xs text-muted-foreground">
              Team
            </Label>
            <select id="p-team" className={sel} disabled={!canAssign || busy} value={ticket.team?.id ?? ""} onChange={(e) => assign({ teamId: e.target.value || null })}>
              <option value="">No team</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="p-assignee" className="text-xs text-muted-foreground">
                Assignee
              </Label>
              {canAssign && ticket.assignee?.id !== me.id && (
                <button className="text-xs text-primary hover:underline" disabled={busy} onClick={() => assign({ assigneeId: me.id })}>
                  Assign to me
                </button>
              )}
            </div>
            <select id="p-assignee" className={sel} disabled={!canAssign || busy} value={ticket.assignee?.id ?? ""} onChange={(e) => assign({ assigneeId: e.target.value || null })}>
              <option value="">Unassigned</option>
              {(perms.reassign ? agents : teamAgents).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="p-impact" className="text-xs text-muted-foreground">
                Impact
              </Label>
              <select id="p-impact" className={sel} disabled={!perms.update || busy} value={ticket.impact ?? ""} onChange={(e) => patch({ impact: e.target.value || null })}>
                <option value="">—</option>
                {meta.impact.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-urgency" className="text-xs text-muted-foreground">
                Urgency
              </Label>
              <select id="p-urgency" className={sel} disabled={!perms.update || busy} value={ticket.urgency ?? ""} onChange={(e) => patch({ urgency: e.target.value || null })}>
                <option value="">—</option>
                {meta.urgency.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-priority" className="text-xs text-muted-foreground">
              Priority
            </Label>
            <select id="p-priority" className={sel} disabled={!perms.update || busy} value={ticket.priority} onChange={(e) => patch({ priority: e.target.value })}>
              {meta.priorities.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-category" className="text-xs text-muted-foreground">
              Category
            </Label>
            <select id="p-category" className={sel} disabled={!perms.update || busy} value={ticket.category?.id ?? ""} onChange={(e) => patch({ categoryId: e.target.value || null })}>
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-due" className="text-xs text-muted-foreground">
              Due date
            </Label>
            <Input
              id="p-due"
              type="date"
              disabled={!perms.update || busy}
              defaultValue={ticket.dueAt?.slice(0, 10) ?? ""}
              onBlur={(e) => {
                const v = e.target.value ? new Date(`${e.target.value}T17:00:00Z`).toISOString() : null;
                if ((v?.slice(0, 10) ?? null) !== (ticket.dueAt?.slice(0, 10) ?? null)) void patch({ dueAt: v });
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-tags" className="text-xs text-muted-foreground">
              Tags
            </Label>
            <Input
              id="p-tags"
              disabled={!perms.update || busy}
              defaultValue={ticket.tags.join(", ")}
              placeholder="comma, separated"
              onBlur={(e) => {
                const tags = e.target.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
                if (JSON.stringify(tags) !== JSON.stringify(ticket.tags)) void patch({ tags });
              }}
            />
          </div>
        </CardContent>
      </Card>

      {typeMeta && typeMeta.fields.length > 0 && (
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">{ticket.type.name} details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-4">
            <fieldset disabled={!perms.update || busy} className="space-y-3">
              <FieldInputs
                fields={typeMeta.fields}
                values={fields}
                idPrefix="tf"
                assets={features.assets ? assets : undefined}
                agents={agents}
                onChange={(k, v) => {
                  setFields((s) => ({ ...s, [k]: v }));
                  setFieldsDirty(true);
                }}
              />
            </fieldset>
            {fieldsDirty && (
              <Button
                size="sm"
                onClick={async () => {
                  if (await patch({ fields })) setFieldsDirty(false);
                }}
              >
                Save details
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {typeMeta?.feature && <ItsmPanel kind={typeMeta.feature === "problemManagement" ? "problem" : "change"} ticket={ticket} meta={meta} perms={perms} patch={patch} />}

      <Card className="gap-2 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm">Watchers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-4 text-sm">
          <ul className="space-y-1">
            {(ticket.watchers ?? []).map((w) => (
              <li key={w.userId ?? w.email} className="flex items-center justify-between gap-2">
                <span className="truncate">{w.name ?? w.email}</span>
                {perms.update && (
                  <button
                    aria-label={`Remove ${w.name ?? w.email}`}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                    onClick={() => call(`/api/v1/tickets/${ticket.id}/watchers`, w.userId ? { remove: [w.userId] } : { removeEmails: [w.email] }, "POST", "Watcher removed")}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
            {!(ticket.watchers ?? []).length && <li className="text-muted-foreground">Nobody else is watching.</li>}
          </ul>
          {perms.update && (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const v = String(new FormData(e.currentTarget).get("watcher") ?? "").trim();
                if (!v) return;
                const agent = agents.find((a) => a.id === v);
                await call(`/api/v1/tickets/${ticket.id}/watchers`, agent ? { add: [v] } : { addEmails: [v] }, "POST", "Watcher added");
                e.currentTarget?.reset();
              }}
            >
              <Input name="watcher" list="watcher-agents" placeholder="Agent or CC email" aria-label="Add watcher" className="h-8" />
              <datalist id="watcher-agents">
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </datalist>
              <Button size="sm" variant="secondary" type="submit">
                Add
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="gap-2 py-4">
        <CardContent className="space-y-1 px-4 text-xs text-muted-foreground">
          <p>Created {formatDateTime(ticket.createdAt, meta.timezone)}</p>
          <p>Updated {formatDateTime(ticket.updatedAt, meta.timezone)}</p>
          {ticket.firstRespondedAt && <p>First response {formatDateTime(ticket.firstRespondedAt, meta.timezone)}</p>}
          {ticket.resolvedAt && <p>Resolved {formatDateTime(ticket.resolvedAt, meta.timezone)}</p>}
        </CardContent>
      </Card>
    </>
  );
}

/** Problem / change management fields (Phase 6 modules). */
function ItsmPanel({ kind, ticket, meta, perms, patch }: { kind: "problem" | "change"; ticket: WorkspaceProps["ticket"]; meta: WorkspaceProps["meta"]; perms: WorkspaceProps["perms"]; patch: (b: Record<string, unknown>) => Promise<unknown> }) {
  const isProblem = kind === "problem";
  const save = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {};
    for (const [k, v] of f.entries()) body[k] = v === "" ? null : v;
    if (isProblem) body.knownError = f.get("knownError") === "on";
    for (const k of ["plannedStartAt", "plannedEndAt"]) if (body[k]) body[k] = new Date(String(body[k])).toISOString();
    void patch(body);
  };
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">{isProblem ? "Root cause analysis" : "Change plan"}</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <form onSubmit={save} className="space-y-3">
          <fieldset disabled={!perms.update} className="space-y-3">
            {isProblem ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="i-rc" className="text-xs text-muted-foreground">Root cause</Label>
                  <Textarea id="i-rc" name="rootCause" defaultValue={ticket.rootCause ?? ""} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="i-wa" className="text-xs text-muted-foreground">Workaround</Label>
                  <Textarea id="i-wa" name="workaround" defaultValue={ticket.workaround ?? ""} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="knownError" defaultChecked={ticket.knownError} /> Known error (publish workaround to agents)
                </label>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <Label htmlFor="i-risk" className="text-xs text-muted-foreground">Risk</Label>
                  <select id="i-risk" name="riskLevel" defaultValue={ticket.riskLevel ?? ""} className={sel}>
                    <option value="">—</option>
                    {meta.riskLevels.map((r) => (
                      <option key={r.key} value={r.key}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="i-start" className="text-xs text-muted-foreground">Window start</Label>
                    <Input id="i-start" name="plannedStartAt" type="datetime-local" defaultValue={ticket.plannedStartAt?.slice(0, 16) ?? ""} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="i-end" className="text-xs text-muted-foreground">Window end</Label>
                    <Input id="i-end" name="plannedEndAt" type="datetime-local" defaultValue={ticket.plannedEndAt?.slice(0, 16) ?? ""} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="i-plan" className="text-xs text-muted-foreground">Implementation plan</Label>
                  <Textarea id="i-plan" name="changePlan" defaultValue={ticket.changePlan ?? ""} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="i-rb" className="text-xs text-muted-foreground">Rollback plan</Label>
                  <Textarea id="i-rb" name="rollbackPlan" defaultValue={ticket.rollbackPlan ?? ""} />
                </div>
                {ticket.cabStatus && ticket.cabStatus !== "NOT_REQUIRED" && <p className="text-xs">CAB: {ticket.cabStatus.toLowerCase()}</p>}
              </>
            )}
            <Button size="sm" type="submit">Save</Button>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}
