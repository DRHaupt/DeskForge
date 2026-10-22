/** Console navigation. Items are filtered by permission and feature flag on the server. */
import type { FeatureName } from "@/core/config/schema";
import type { Permission } from "@/core/rbac/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** Any one of these permissions shows the item. */
  permissions?: Permission[];
  feature?: FeatureName;
};

export type NavSection = { label?: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    items: [
      { href: "/agent", label: "Home", icon: "home", permissions: ["ticket.view_team", "ticket.view_all"] },
      { href: "/agent/tickets", label: "Tickets", icon: "inbox", permissions: ["ticket.view_team", "ticket.view_all"] },
      { href: "/agent/search", label: "Search", icon: "list", permissions: ["ticket.view_team", "ticket.view_all"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/users", label: "Users", icon: "users", permissions: ["user.view"] },
      { href: "/admin/roles", label: "Roles", icon: "shield", permissions: ["role.manage"] },
      { href: "/admin/teams", label: "Teams", icon: "users-round", permissions: ["team.manage"] },
      { href: "/admin/organizations", label: "Organizations", icon: "building", permissions: ["org.view"] },
      { href: "/admin/email", label: "Email log", icon: "message", permissions: ["config.view"] },
      { href: "/admin/audit", label: "Audit log", icon: "scroll", permissions: ["audit.view"] },
    ],
  },
];
