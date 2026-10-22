"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { PriorityBadge, StatusBadge } from "@/components/tickets/badges";
import { SlaBadge } from "@/components/tickets/sla-badge";
import { api } from "@/lib/api-client";
import { timeAgo } from "@/lib/format";
import { stateColor, stateLabel, type TicketMeta } from "@/lib/ticket-meta";
import { cn } from "@/lib/utils";

export type Row = {
  id: string;
  number: string;
  title: string;
  typeKey: string;
  status: string;
  statusCategory: string;
  priority: string;
  requester: string;
  organization: string | null;
  assignee: string | null;
  team: string | null;
  updatedAt: string;
  sla: { metric: string; status: string; dueAt: string; breachedAt: string | null }[];
};

const sel = "h-8 rounded-md border border-input bg-background px-2 text-sm";

export function TicketTable({ items, meta, canBulk, teams, agents }: { items: Row[]; meta: TicketMeta; canBulk: boolean; teams: { id: string; name: string }[]; agents: { id: string; name: string }[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const rows = useRef<(HTMLTableRowElement | null)[]>([]);

  const toggle = useCallback((id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  }), []);

  // j/k to move, x to select, Enter/o to open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!items.length) return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        setCursor((c) => {
          const next = Math.max(0, Math.min(items.length - 1, c + (e.key === "j" ? 1 : -1)));
          rows.current[next]?.focus();
          return next;
        });
      } else if (e.key === "x" && canBulk) {
        e.preventDefault();
        toggle(items[cursor]!.id);
      } else if (e.key === "Enter" || e.key === "o") {
        if (t.tagName === "A" || t.tagName === "BUTTON") return;
        e.preventDefault();
        router.push(`/agent/tickets/${items[cursor]!.number}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, cursor, canBulk, router, toggle]);

  async function bulk(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await api<{ ok: number; failed: number; results: { ok: boolean; error?: string }[] }>("/api/v1/tickets/bulk", { body: { ids: [...selected], ...body } });
      if (res.failed) toast.warning(`${res.ok} updated, ${res.failed} failed: ${res.results.find((r) => !r.ok)?.error ?? ""}`);
      else toast.success(`${res.ok} ticket(s) updated`);
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const statuses = [...new Map(meta.types.filter((t) => items.some((i) => i.typeKey === t.key)).flatMap((t) => t.states).map((s) => [s.key, s])).values()];
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));

  return (
    <>
      {canBulk && selected.size > 0 && (
        <div role="region" aria-label="Bulk actions" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-2 text-sm">
          <span className="px-1 font-medium">{selected.size} selected</span>
          <select aria-label="Set status" className={sel} disabled={busy} value="" onChange={(e) => e.target.value && bulk({ status: e.target.value })}>
            <option value="">Set status…</option>
            {statuses.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
          </select>
          <select aria-label="Set priority" className={sel} disabled={busy} value="" onChange={(e) => e.target.value && bulk({ priority: e.target.value })}>
            <option value="">Set priority…</option>
            {meta.priorities.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
          <select aria-label="Move to team" className={sel} disabled={busy} value="" onChange={(e) => e.target.value && bulk({ teamId: e.target.value })}>
            <option value="">Move to team…</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select aria-label="Assign to" className={sel} disabled={busy} value="" onChange={(e) => e.target.value && bulk({ assigneeId: e.target.value === "none" ? null : e.target.value })}>
            <option value="">Assign to…</option>
            <option value="none">Unassigned</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              const tag = window.prompt("Tag to add");
              if (tag) void bulk({ addTags: [tag] });
            }}
          >
            Add tag
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}
      <Card className="py-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {canBulk && (
                  <th className="w-8 px-3 py-2">
                    <Checkbox aria-label="Select all" checked={allSelected} onCheckedChange={(v) => setSelected(v ? new Set(items.map((i) => i.id)) : new Set())} />
                  </th>
                )}
                <th className="px-2 py-2 font-medium">Ticket</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Priority</th>
                <th className="hidden px-2 py-2 font-medium md:table-cell">Assignee</th>
                <th className="hidden px-2 py-2 font-medium lg:table-cell">SLA</th>
                <th className="hidden px-2 py-2 font-medium sm:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t, i) => {
                const pr = meta.priorities.find((p) => p.key === t.priority);
                return (
                  <tr
                    key={t.id}
                    ref={(el) => {
                      rows.current[i] = el;
                    }}
                    tabIndex={-1}
                    onFocus={() => setCursor(i)}
                    className={cn("border-b last:border-0 hover:bg-muted/40 focus:bg-muted/60 focus:outline-none", selected.has(t.id) && "bg-primary/5", cursor === i && "shadow-[inset_3px_0_0_var(--primary)]")}
                  >
                    {canBulk && (
                      <td className="px-3 py-2">
                        <Checkbox aria-label={`Select ${t.number}`} checked={selected.has(t.id)} onCheckedChange={() => toggle(t.id)} />
                      </td>
                    )}
                    <td className="max-w-md px-2 py-2">
                      <Link href={`/agent/tickets/${t.number}`} className="font-medium hover:underline">
                        <span className="mr-2 font-mono text-xs text-muted-foreground">{t.number}</span>
                        {t.title}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">
                        {t.requester}
                        {t.organization && ` · ${t.organization}`}
                        {t.team && ` · ${t.team}`}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <StatusBadge label={stateLabel(meta, t.typeKey, t.status)} color={stateColor(meta, t.typeKey, t.status)} category={t.statusCategory} />
                    </td>
                    <td className="px-2 py-2">
                      <PriorityBadge label={pr?.name ?? t.priority} color={pr?.color} />
                    </td>
                    <td className="hidden px-2 py-2 md:table-cell">{t.assignee ?? <span className="text-muted-foreground">Unassigned</span>}</td>
                    <td className="hidden px-2 py-2 lg:table-cell">
                      <SlaBadge sla={t.sla} compact />
                    </td>
                    <td className="hidden px-2 py-2 whitespace-nowrap text-muted-foreground sm:table-cell" title={new Date(t.updatedAt).toLocaleString()}>
                      {timeAgo(t.updatedAt)}
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    Nothing here. Nice work.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="mt-2 hidden text-xs text-muted-foreground sm:block">
        Shortcuts: <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>x</kbd> select · <kbd>Enter</kbd> open · <kbd>c</kbd> new ticket · <kbd>/</kbd> search · <kbd>?</kbd> all shortcuts
      </p>
    </>
  );
}
