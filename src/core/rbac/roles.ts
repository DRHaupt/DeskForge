/** Built-in roles, created on first sync. Admins can edit their permissions afterwards. */
import { ALL_PERMISSIONS, type Permission, WILDCARD } from "./permissions";

export type RoleDefinition = {
  key: string;
  name: string;
  description: string;
  permissions: (Permission | typeof WILDCARD)[];
};

const AGENT: Permission[] = [
  "ticket.view_own",
  "ticket.view_team",
  "ticket.create",
  "ticket.create_on_behalf",
  "ticket.update",
  "ticket.reply",
  "ticket.comment_internal",
  "ticket.assign",
  "ticket.transition",
  "ticket.link",
  "ticket.bulk",
  "kb.view_internal",
  "kb.author",
  "catalog.request",
  "problem.manage",
  "change.manage",
  "asset.view",
  "user.view",
  "org.view",
];

const TEAM_LEAD: Permission[] = [
  ...AGENT,
  "ticket.view_all",
  "ticket.reassign",
  "sla.override",
  "kb.publish",
  "catalog.approve",
  "change.approve",
  "asset.manage",
  "report.view",
  "report.export",
  "canned.manage",
  "view.share",
];

export const BUILT_IN_ROLES: RoleDefinition[] = [
  { key: "admin", name: "Admin", description: "Full access to configuration, users, roles and integrations.", permissions: [WILDCARD] },
  { key: "team_lead", name: "Team Lead", description: "Agent permissions plus reassignment, reporting and SLA overrides.", permissions: TEAM_LEAD },
  { key: "agent", name: "Agent", description: "Works tickets in their teams' queues and writes knowledge base articles.", permissions: AGENT },
  {
    key: "requester",
    name: "Requester",
    description: "Customer portal access: submit, view and reply to their own tickets.",
    permissions: ["ticket.view_own", "ticket.create", "ticket.reply", "catalog.request"],
  },
  {
    key: "auditor",
    name: "Auditor",
    description: "Read-only access to tickets, reports and the audit log.",
    permissions: ["ticket.view_all", "kb.view_internal", "asset.view", "report.view", "report.export", "user.view", "org.view", "config.view", "audit.view"],
  },
];

export const ROLE_KEYS = BUILT_IN_ROLES.map((r) => r.key);

/** Expand a list of grants (which may include "*") into a concrete permission set. */
export function expandPermissions(grants: string[]): Set<Permission> {
  if (grants.includes(WILDCARD)) return new Set(ALL_PERMISSIONS);
  return new Set(grants.filter((g): g is Permission => (ALL_PERMISSIONS as string[]).includes(g)));
}
