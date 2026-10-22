"use client";

import { useRouter } from "next/navigation";
import { Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";
import type { TicketMeta } from "@/lib/ticket-meta";

const sel = "h-9 rounded-md border border-input bg-transparent px-2 text-sm";

export function FilterBar({
  active,
  meta,
  teams,
  agents,
  canShare,
  savedViewId,
}: {
  active: Record<string, string>;
  meta: TicketMeta;
  teams: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  canShare: boolean;
  savedViewId?: string;
}) {
  const router = useRouter();

  function apply(form: HTMLFormElement) {
    const f = new FormData(form);
    const sp = new URLSearchParams();
    for (const [k, v] of f.entries()) if (typeof v === "string" && v) sp.set(k, v);
    // Keep filters that the bar doesn't show (e.g. watching, requester) from the active view.
    for (const k of ["watching", "requesterId", "organizationId", "categoryId", "tag", "statusCategory", "createdFrom", "createdTo"]) if (active[k] && !sp.has(k)) sp.set(k, active[k]!);
    router.push(`/agent/tickets?${sp.toString()}`);
  }

  async function saveView() {
    const name = window.prompt("Name for this view");
    if (!name) return;
    const share = canShare && window.confirm("Share this view with all agents?");
    try {
      const view = await api<{ id: string }>("/api/v1/views", { body: { name, isShared: share, filters: active } });
      toast.success("View saved");
      router.push(`/agent/tickets?view=${view.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function deleteView() {
    if (!savedViewId || !window.confirm("Delete this saved view?")) return;
    await api(`/api/v1/views/${savedViewId}`, { method: "DELETE" });
    router.push("/agent/tickets");
  }

  const statuses = [...new Map(meta.types.flatMap((t) => t.states).map((s) => [s.key, s])).values()];

  return (
    <form
      key={JSON.stringify(active)}
      role="search"
      aria-label="Filter tickets"
      className="mb-4 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply(e.currentTarget);
      }}
      onChange={(e) => {
        if ((e.target as HTMLElement).tagName === "SELECT") apply(e.currentTarget);
      }}
    >
      <Input name="q" defaultValue={active.q} placeholder="Search number, title, requester…" className="w-full sm:w-64" aria-label="Search tickets" />
      <select name="open" defaultValue={active.open ?? ""} aria-label="Open or closed" className={sel}>
        <option value="">Any state</option>
        <option value="true">Open</option>
        <option value="false">Resolved/closed</option>
      </select>
      <select name="status" defaultValue={active.status ?? ""} aria-label="Status" className={sel}>
        <option value="">Any status</option>
        {statuses.map((s) => (
          <option key={s.key} value={s.key}>
            {s.name}
          </option>
        ))}
      </select>
      <select name="priority" defaultValue={active.priority ?? ""} aria-label="Priority" className={sel}>
        <option value="">Any priority</option>
        {meta.priorities.map((p) => (
          <option key={p.key} value={p.key}>
            {p.name}
          </option>
        ))}
      </select>
      <select name="type" defaultValue={active.type ?? ""} aria-label="Type" className={sel}>
        <option value="">Any type</option>
        {meta.types.map((t) => (
          <option key={t.key} value={t.key}>
            {t.name}
          </option>
        ))}
      </select>
      <select name="teamId" defaultValue={active.teamId ?? ""} aria-label="Team" className={sel}>
        <option value="">Any team</option>
        <option value="none">No team</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <select name="assignee" defaultValue={active.assignee ?? ""} aria-label="Assignee" className={sel}>
        <option value="">Anyone</option>
        <option value="me">Me</option>
        <option value="none">Unassigned</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select name="sort" defaultValue={active.sort ?? "updated"} aria-label="Sort by" className={sel}>
        <option value="updated">Recently updated</option>
        <option value="created">Newest</option>
        <option value="priority">Priority</option>
        <option value="due">Due date</option>
        <option value="number">Number</option>
      </select>
      <Button type="submit" variant="secondary" size="sm">
        Apply
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={saveView}>
        <Save /> Save view
      </Button>
      {savedViewId && (
        <Button type="button" variant="ghost" size="sm" onClick={deleteView}>
          <X /> Delete view
        </Button>
      )}
    </form>
  );
}
