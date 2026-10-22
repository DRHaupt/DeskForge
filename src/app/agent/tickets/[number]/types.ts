import type { TicketMeta } from "@/lib/ticket-meta";

export type LinkRow = {
  id: string;
  type: string;
  direction: "outgoing" | "incoming";
  ticket: { id: string; number: string; title: string; status: string; statusCategory: string } | null;
  asset: { id: string; tag: string; name: string } | null;
};

export type TicketView = {
  id: string;
  number: string;
  type: { key: string; name: string };
  title: string;
  description: string;
  status: string;
  statusCategory: string;
  priority: string;
  impact: string | null;
  urgency: string | null;
  source: string;
  requester: { id: string; name: string; email: string };
  organization: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  tags: string[];
  fields: Record<string, unknown>;
  watchers?: { userId: string | null; email: string | null; name: string | null }[];
  links: LinkRow[];
  mergedInto: { id: string; number: string } | null;
  sla: { metric: string; status: string; dueAt: string; breachedAt: string | null; policy: string }[];
  dueAt: string | null;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  transitions: { to: string; name: string; requireComment: boolean; category: string }[];
  rootCause?: string | null;
  workaround?: string | null;
  knownError?: boolean;
  riskLevel?: string | null;
  changePlan?: string | null;
  rollbackPlan?: string | null;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  cabStatus?: string;
};

export type TimelineEntry =
  | { kind: "comment"; id: string; at: string; visibility: "PUBLIC" | "INTERNAL"; source: string; isSystem: boolean; author: { id: string; name: string } | null; body: string; attachments: { id: string; filename: string; size: number; contentType: string }[] }
  | { kind: "status"; id: string; at: string; from: string | null; to: string; by: string | null; reason: string | null }
  | { kind: "activity"; id: string; at: string; action: string; by: string | null; changes: Record<string, unknown> | null };

export type WorkspaceProps = {
  ticket: TicketView;
  timeline: TimelineEntry[];
  meta: TicketMeta;
  me: { id: string; name: string };
  perms: { update: boolean; reply: boolean; internal: boolean; assign: boolean; reassign: boolean; link: boolean; delete: boolean; slaOverride: boolean };
  teams: { id: string; name: string }[];
  agents: { id: string; name: string; teamIds: string[] }[];
  categories: { id: string; label: string }[];
  assets: { id: string; label: string }[];
  canned: { id: string; name: string; body: string; actions: unknown }[];
  features: { problem: boolean; change: boolean; assets: boolean };
};
