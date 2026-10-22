/**
 * Permission catalog. Permission names are defined in code (so the app can
 * check them); which roles hold them is data, editable in the admin UI.
 */

export const PERMISSIONS = {
  // Tickets
  "ticket.view_own": "View tickets you requested",
  "ticket.view_org": "View tickets from your organization",
  "ticket.view_team": "View tickets in your teams' queues",
  "ticket.view_all": "View all tickets",
  "ticket.create": "Create tickets",
  "ticket.create_on_behalf": "Create tickets on behalf of another requester",
  "ticket.update": "Edit ticket fields",
  "ticket.reply": "Send public replies",
  "ticket.comment_internal": "Add internal notes",
  "ticket.assign": "Assign tickets to yourself or within your teams",
  "ticket.reassign": "Reassign tickets to any team or agent",
  "ticket.transition": "Change ticket status",
  "ticket.link": "Link and merge tickets",
  "ticket.bulk": "Bulk-edit tickets",
  "ticket.delete": "Delete tickets",
  "sla.override": "Override SLA due dates",
  // Knowledge base
  "kb.view_internal": "Read internal knowledge base articles",
  "kb.author": "Write and edit knowledge base drafts",
  "kb.publish": "Publish and archive knowledge base articles",
  // Catalog / approvals
  "catalog.request": "Request service catalog items",
  "catalog.manage": "Manage service catalog items",
  "catalog.approve": "Approve catalog requests",
  // ITSM extras
  "problem.manage": "Manage problems and known errors",
  "change.manage": "Create and manage change requests",
  "change.approve": "Vote on change requests (CAB)",
  "asset.view": "View assets",
  "asset.manage": "Create, edit and import assets",
  // Reporting
  "report.view": "View dashboards and reports",
  "report.export": "Export reports to CSV",
  // Agent productivity
  "canned.manage": "Manage shared canned responses and macros",
  "view.share": "Create shared saved views",
  // Administration
  "user.view": "View users",
  "user.manage": "Create, edit and deactivate users",
  "org.view": "View organizations",
  "org.manage": "Manage organizations",
  "role.manage": "Edit roles and permissions",
  "team.manage": "Manage teams and members",
  "automation.manage": "Manage automations",
  "webhook.manage": "Manage webhooks",
  "apikey.manage": "Manage API keys",
  "config.view": "View system configuration",
  "config.edit": "Edit system configuration",
  "audit.view": "View the audit log",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Grouping for the role editor UI. */
export function permissionGroup(p: Permission): string {
  const prefix = p.split(".")[0]!;
  const names: Record<string, string> = {
    ticket: "Tickets",
    sla: "Tickets",
    kb: "Knowledge base",
    catalog: "Service catalog",
    problem: "ITSM",
    change: "ITSM",
    asset: "Assets",
    report: "Reporting",
    canned: "Agent tools",
    view: "Agent tools",
    user: "Administration",
    org: "Administration",
    role: "Administration",
    team: "Administration",
    automation: "Integrations",
    webhook: "Integrations",
    apikey: "Integrations",
    config: "Administration",
    audit: "Administration",
  };
  return names[prefix] ?? "Other";
}

export function isPermission(p: string): p is Permission {
  return p in PERMISSIONS;
}

/** Wildcard grant used by the Admin role. */
export const WILDCARD = "*";
