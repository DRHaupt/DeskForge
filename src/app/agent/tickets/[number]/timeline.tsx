"use client";

import { Lock, ArrowRight, Mail, Paperclip, Activity } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { formatBytes } from "@/components/tickets/attachment-uploader";
import { formatDateTime, timeAgo } from "@/lib/format";
import { stateLabel, type TicketMeta } from "@/lib/ticket-meta";
import { cn } from "@/lib/utils";
import type { TimelineEntry } from "./types";

const ACTIVITY: Record<string, string> = {
  "ticket.update": "updated",
  "ticket.assign": "changed assignment",
  "ticket.link": "linked a ticket",
  "ticket.unlink": "removed a link",
  "ticket.merge": "merged tickets",
  "ticket.watchers": "changed watchers",
  "sla.override": "overrode an SLA",
};

function describeChanges(action: string, changes: Record<string, unknown> | null): string {
  if (!changes) return "";
  if (action === "ticket.assign") {
    const parts = [];
    if ("team" in changes && changes.teamId) parts.push(`team → ${changes.team ?? "none"}`);
    if ("assignee" in changes && changes.assigneeId) parts.push(`assignee → ${changes.assignee ?? "nobody"}`);
    return parts.join(", ");
  }
  if (action === "ticket.link") return `${String(changes.type ?? "").toLowerCase().replace(/_/g, " ")} ${changes.target ?? changes.source ?? changes.asset ?? ""}`;
  if (action === "ticket.merge") return changes.into ? `into ${changes.into}` : `from ${changes.from}`;
  return Object.entries(changes)
    .filter(([k]) => !["description"].includes(k))
    .map(([k, v]) => {
      const c = v as { to?: unknown };
      const to = Array.isArray(c?.to) ? c.to.join(", ") : c?.to;
      return `${k.replace(/^field\./, "")} → ${to === null || to === undefined || to === "" ? "—" : String(to)}`;
    })
    .join(", ");
}

export function Timeline({ items, meta, typeKey }: { items: TimelineEntry[]; meta: TicketMeta; typeKey: string }) {
  return (
    <ol className="space-y-4" aria-label="Ticket history">
      {items.map((i) => {
        if (i.kind === "comment") {
          const internal = i.visibility === "INTERNAL";
          return (
            <li key={i.id} className={cn("rounded-lg border bg-card", internal && "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30", i.isSystem && "border-dashed")}>
              <div className="flex flex-wrap items-center gap-2 border-b border-inherit px-4 py-2 text-sm">
                <Avatar name={i.author?.name ?? "System"} className="size-6" />
                <span className="font-medium">{i.author?.name ?? "System"}</span>
                {internal && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                    <Lock className="size-3" /> Internal note
                  </span>
                )}
                {i.source === "EMAIL" && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Mail className="size-3" /> via email
                  </span>
                )}
                <time className="ml-auto text-xs text-muted-foreground" dateTime={i.at} title={formatDateTime(i.at, meta.timezone)}>
                  {timeAgo(i.at)}
                </time>
              </div>
              <div className="prose-df px-4 py-3" dangerouslySetInnerHTML={{ __html: i.body }} />
              {i.attachments.length > 0 && (
                <ul className="flex flex-wrap gap-2 px-4 pb-3">
                  {i.attachments.map((a) => (
                    <li key={a.id}>
                      <a href={`/api/v1/attachments/${a.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-xs hover:bg-accent">
                        <Paperclip className="size-3" /> {a.filename} <span className="text-muted-foreground">({formatBytes(a.size)})</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        }
        if (i.kind === "status") {
          return (
            <li key={i.id} className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground">
              <ArrowRight className="size-3.5" />
              <span>
                {i.by ?? "System"} {i.from ? "changed status" : "opened the ticket as"}
                {i.from && (
                  <>
                    {" "}
                    from <strong className="font-medium text-foreground">{stateLabel(meta, typeKey, i.from)}</strong> to
                  </>
                )}{" "}
                <strong className="font-medium text-foreground">{stateLabel(meta, typeKey, i.to)}</strong>
                {i.reason && i.reason !== "created" && <> ({i.reason})</>}
              </span>
              <time className="ml-auto" dateTime={i.at} title={formatDateTime(i.at, meta.timezone)}>
                {timeAgo(i.at)}
              </time>
            </li>
          );
        }
        return (
          <li key={i.id} className="flex flex-wrap items-center gap-2 px-1 text-xs text-muted-foreground">
            <Activity className="size-3.5" />
            <span>
              {i.by?.replace(/^system:/, "Automation: ") ?? "System"} {ACTIVITY[i.action] ?? i.action} <span className="text-foreground">{describeChanges(i.action, i.changes)}</span>
            </span>
            <time className="ml-auto" dateTime={i.at} title={formatDateTime(i.at, meta.timezone)}>
              {timeAgo(i.at)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
