"use client";

import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";

type Sla = { metric: string; status: string; dueAt: string | Date };

/** Shows the most urgent running SLA timer: time left, or how long overdue. */
export function SlaBadge({ sla, compact = false, now = Date.now() }: { sla: Sla[]; compact?: boolean; now?: number }) {
  const active = sla.filter((s) => s.status === "RUNNING" || s.status === "PAUSED" || s.status === "BREACHED");
  if (!active.length) return compact ? <span className="text-xs text-muted-foreground">—</span> : null;
  const next = active.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0]!;
  const mins = (new Date(next.dueAt).getTime() - now) / 60000;
  const breached = next.status === "BREACHED" || mins < 0;
  const paused = next.status === "PAUSED";
  const label = next.metric === "FIRST_RESPONSE" ? "Response" : "Resolve";
  const text = paused ? "paused" : breached ? `${formatMinutes(-mins)} over` : `${formatMinutes(mins)} left`;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        breached ? "bg-destructive/10 text-destructive" : paused ? "bg-muted text-muted-foreground" : mins < 60 ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-muted text-foreground",
      )}
      title={`${label} due ${new Date(next.dueAt).toLocaleString()}`}
    >
      {!compact && `${label}: `}
      {text}
    </span>
  );
}
