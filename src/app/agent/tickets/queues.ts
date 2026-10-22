/** Built-in queue presets for the agent console sidebar. */
import type { UserActor } from "@/core/rbac/actor";

export type QueuePreset = { id: string; label: string; filters: Record<string, string> };

export function queuePresets(actor: UserActor, teams: { id: string; name: string }[]): QueuePreset[] {
  const mine = teams.filter((t) => actor.teamIds.includes(t.id));
  return [
    { id: "mine", label: "My open tickets", filters: { assignee: "me", open: "true" } },
    { id: "unassigned", label: "Unassigned", filters: { assignee: "none", open: "true", ...(mine.length ? { teamId: [...mine.map((t) => t.id), "none"].join(",") } : {}) } },
    ...mine.map((t) => ({ id: `team-${t.id}`, label: t.name, filters: { teamId: t.id, open: "true" } })),
    { id: "watching", label: "Watching", filters: { watching: "true", open: "true" } },
    { id: "open", label: "All open", filters: { open: "true" } },
    { id: "resolved", label: "Recently resolved", filters: { statusCategory: "RESOLVED,CLOSED", sort: "updated" } },
  ];
}
