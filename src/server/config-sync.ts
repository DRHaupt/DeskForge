/**
 * Syncs business.config.yaml into the database so foreign keys and reporting
 * work. Runs at container start (scripts/docker-entrypoint.sh), in the seed,
 * and can be run by hand with `npm run config:sync`.
 *
 * Ownership rules (DECISIONS.md D-006):
 * - Config-owned, updated on every sync: ticket types (+ custom fields),
 *   SLA policies, categories. Removed entries are deactivated, never deleted,
 *   so old tickets keep their history.
 * - Bootstrap-only, created if missing and then owned by the admin UI:
 *   roles, teams, catalog items, organizations.
 * - Team members from config are applied once per (team, email) pair. If an
 *   admin removes someone later, the next sync does not add them back.
 */
import type { BusinessConfig, CategoryInput, FieldConfig } from "@/core/config/schema";
import { BUILT_IN_ROLES } from "@/core/rbac/roles";
import type { Db, Tx } from "./db";
import { logger } from "./logger";
import { AssignmentStrategy, FieldType, SlaCalendar } from "@/generated/prisma/enums";

const FIELD_TYPE_MAP: Record<FieldConfig["type"], FieldType> = {
  text: FieldType.TEXT,
  textarea: FieldType.TEXTAREA,
  number: FieldType.NUMBER,
  dropdown: FieldType.DROPDOWN,
  multiselect: FieldType.MULTISELECT,
  date: FieldType.DATE,
  user: FieldType.USER,
  asset: FieldType.ASSET,
  checkbox: FieldType.CHECKBOX,
};

const STRATEGY_MAP = {
  round_robin: AssignmentStrategy.ROUND_ROBIN,
  load_balanced: AssignmentStrategy.LOAD_BALANCED,
  manual: AssignmentStrategy.MANUAL,
} as const;

const APPLIED_MEMBERS_KEY = "config_sync.applied_team_members";

export type SyncReport = {
  roles: number;
  ticketTypes: number;
  fields: number;
  slaPolicies: number;
  categories: number;
  teams: number;
  teamMembersAdded: number;
  catalogItems: number;
  organizations: number;
  deactivated: string[];
};

export async function syncConfigToDatabase(db: Db, cfg: BusinessConfig): Promise<SyncReport> {
  const report: SyncReport = {
    roles: 0,
    ticketTypes: 0,
    fields: 0,
    slaPolicies: 0,
    categories: 0,
    teams: 0,
    teamMembersAdded: 0,
    catalogItems: 0,
    organizations: 0,
    deactivated: [],
  };

  await db.$transaction(
    async (tx) => {
      // Only one process syncs at a time (app replicas + worker may start together).
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('deskforge_config_sync'))`);

      await syncRoles(tx, report);
      await syncTicketTypes(tx, cfg, report);
      await syncSlaPolicies(tx, cfg, report);
      await syncCategories(tx, cfg, report);
      await syncTeams(tx, cfg, report);
      await syncCatalog(tx, cfg, report);
      await syncOrganizations(tx, cfg, report);
    },
    { timeout: 60_000 },
  );

  logger.info({ report }, "config synced to database");
  return report;
}

async function syncRoles(tx: Tx, report: SyncReport) {
  for (const role of BUILT_IN_ROLES) {
    const existing = await tx.role.findUnique({ where: { key: role.key } });
    if (!existing) {
      await tx.role.create({
        data: { key: role.key, name: role.name, description: role.description, permissions: role.permissions, isSystem: true },
      });
      report.roles++;
    }
  }
}

async function syncTicketTypes(tx: Tx, cfg: BusinessConfig, report: SyncReport) {
  const configured = new Set(cfg.ticketTypes.map((t) => t.key));
  for (const t of cfg.ticketTypes) {
    const active = !t.feature || cfg.features[t.feature];
    const type = await tx.ticketType.upsert({
      where: { key: t.key },
      create: { key: t.key, name: t.name, prefix: t.prefix, numberPadding: t.numberPadding, description: t.description, isActive: active },
      update: { name: t.name, prefix: t.prefix, numberPadding: t.numberPadding, description: t.description ?? null, isActive: active },
    });
    report.ticketTypes++;

    const fieldKeys = new Set(t.fields.map((f) => f.key));
    for (const [order, f] of t.fields.entries()) {
      const data = {
        label: f.label,
        fieldType: FIELD_TYPE_MAP[f.type],
        required: f.required,
        options: f.options ?? undefined,
        helpText: f.helpText ?? null,
        order,
        isActive: true,
      };
      await tx.ticketFieldDef.upsert({
        where: { ticketTypeId_key: { ticketTypeId: type.id, key: f.key } },
        create: { ticketTypeId: type.id, key: f.key, ...data },
        update: data,
      });
      report.fields++;
    }
    const stale = await tx.ticketFieldDef.findMany({ where: { ticketTypeId: type.id, isActive: true } });
    for (const s of stale.filter((s) => !fieldKeys.has(s.key))) {
      await tx.ticketFieldDef.update({ where: { id: s.id }, data: { isActive: false } });
      report.deactivated.push(`field ${t.key}.${s.key}`);
    }
  }
  const removed = await tx.ticketType.findMany({ where: { isActive: true, key: { notIn: [...configured] } } });
  for (const r of removed) {
    await tx.ticketType.update({ where: { id: r.id }, data: { isActive: false } });
    report.deactivated.push(`ticket type ${r.key}`);
  }
}

async function syncSlaPolicies(tx: Tx, cfg: BusinessConfig, report: SyncReport) {
  const keys = new Set(cfg.sla.policies.map((p) => p.key));
  for (const [order, p] of cfg.sla.policies.entries()) {
    const data = {
      name: p.name,
      priorities: p.priorities,
      ticketTypes: p.ticketTypes,
      firstResponseMins: p.firstResponse ?? null,
      resolutionMins: p.resolution ?? null,
      calendar: p.calendar === "always" ? SlaCalendar.ALWAYS : SlaCalendar.BUSINESS_HOURS,
      pauseStatuses: p.pauseStatuses ?? cfg.sla.pauseStatuses,
      warnAtPercent: cfg.sla.warningPercent,
      order,
      isActive: cfg.sla.enabled,
    };
    await tx.sLAPolicy.upsert({ where: { key: p.key }, create: { key: p.key, ...data }, update: data });
    report.slaPolicies++;
  }
  const removed = await tx.sLAPolicy.findMany({ where: { isActive: true, key: { notIn: [...keys] } } });
  for (const r of removed) {
    await tx.sLAPolicy.update({ where: { id: r.id }, data: { isActive: false } });
    report.deactivated.push(`sla policy ${r.key}`);
  }
}

export function flattenCategories(nodes: CategoryInput[], parentPath = "", depth = 0): { path: string; parentPath: string | null; name: string; depth: number; order: number }[] {
  return nodes.flatMap((n, order) => {
    const path = parentPath ? `${parentPath}/${n.key}` : n.key;
    return [{ path, parentPath: parentPath || null, name: n.name, depth, order }, ...flattenCategories(n.children ?? [], path, depth + 1)];
  });
}

async function syncCategories(tx: Tx, cfg: BusinessConfig, report: SyncReport) {
  const flat = flattenCategories(cfg.categories);
  const idByPath = new Map<string, string>();
  // Parents come before children in the flattened list.
  for (const c of flat) {
    const parentId = c.parentPath ? (idByPath.get(c.parentPath) ?? null) : null;
    const row = await tx.category.upsert({
      where: { path: c.path },
      create: { path: c.path, name: c.name, parentId, depth: c.depth, order: c.order },
      update: { name: c.name, parentId, depth: c.depth, order: c.order, isActive: true },
    });
    idByPath.set(c.path, row.id);
    report.categories++;
  }
  const removed = await tx.category.findMany({ where: { isActive: true, path: { notIn: flat.map((c) => c.path) } } });
  for (const r of removed) {
    await tx.category.update({ where: { id: r.id }, data: { isActive: false } });
    report.deactivated.push(`category ${r.path}`);
  }
}

async function syncTeams(tx: Tx, cfg: BusinessConfig, report: SyncReport) {
  for (const t of cfg.teams) {
    const existing = await tx.team.findUnique({ where: { key: t.key } });
    if (!existing) {
      await tx.team.create({
        data: { key: t.key, name: t.name, description: t.description, email: t.email, assignmentStrategy: STRATEGY_MAP[t.assignment] },
      });
      report.teams++;
    }
  }
  // Escalation links, only for teams that do not have one yet.
  for (const t of cfg.teams) {
    if (!t.escalateTo) continue;
    const team = await tx.team.findUniqueOrThrow({ where: { key: t.key } });
    if (team.escalationTeamId || team.escalationUserId) continue;
    const escalationTeam = t.escalateTo.team ? await tx.team.findUnique({ where: { key: t.escalateTo.team } }) : null;
    const escalationUser = t.escalateTo.user ? await tx.user.findUnique({ where: { email: t.escalateTo.user.toLowerCase() } }) : null;
    if (escalationTeam || escalationUser) {
      await tx.team.update({ where: { id: team.id }, data: { escalationTeamId: escalationTeam?.id, escalationUserId: escalationUser?.id } });
    }
  }
  report.teamMembersAdded += await applyConfigTeamMembers(tx, cfg);
}

/**
 * Adds config-listed members whose user accounts exist, once per (team, email).
 * Also called when a user is provisioned, so people listed in config join their
 * teams on first sign-in.
 */
export async function applyConfigTeamMembers(tx: Tx, cfg: BusinessConfig, onlyEmail?: string): Promise<number> {
  const setting = await tx.systemSetting.findUnique({ where: { key: APPLIED_MEMBERS_KEY } });
  const applied = new Set<string>(Array.isArray(setting?.value) ? (setting!.value as string[]) : []);
  let added = 0;
  for (const t of cfg.teams) {
    const team = await tx.team.findUnique({ where: { key: t.key } });
    if (!team) continue;
    const emails = new Set([...t.members, ...t.leads].map((e) => e.toLowerCase()));
    for (const email of emails) {
      if (onlyEmail && email !== onlyEmail.toLowerCase()) continue;
      const pairKey = `${t.key}:${email}`;
      if (applied.has(pairKey)) continue;
      const user = await tx.user.findUnique({ where: { email } });
      if (!user) continue;
      const isLead = t.leads.map((e) => e.toLowerCase()).includes(email);
      await tx.teamMember.upsert({
        where: { teamId_userId: { teamId: team.id, userId: user.id } },
        create: { teamId: team.id, userId: user.id, isLead },
        update: {},
      });
      applied.add(pairKey);
      added++;
    }
  }
  if (added) {
    await tx.systemSetting.upsert({
      where: { key: APPLIED_MEMBERS_KEY },
      create: { key: APPLIED_MEMBERS_KEY, value: [...applied] },
      update: { value: [...applied] },
    });
  }
  return added;
}

async function syncCatalog(tx: Tx, cfg: BusinessConfig, report: SyncReport) {
  for (const [order, item] of cfg.catalog.entries()) {
    const existing = await tx.catalogItem.findUnique({ where: { key: item.key } });
    const approvers = item.approvers.length
      ? await tx.user.findMany({ where: { email: { in: item.approvers.map((e) => e.toLowerCase()) } }, select: { id: true } })
      : [];
    if (existing) {
      // Approver accounts may not have existed on the first sync; fill them in once.
      if (existing.approverIds.length === 0 && approvers.length) {
        await tx.catalogItem.update({ where: { id: existing.id }, data: { approverIds: approvers.map((a) => a.id) } });
      }
      continue;
    }
    const team = item.team ? await tx.team.findUnique({ where: { key: item.team } }) : null;
    await tx.catalogItem.create({
      data: {
        key: item.key,
        name: item.name,
        description: item.description,
        icon: item.icon,
        group: item.group,
        ticketTypeKey: item.ticketType,
        teamId: team?.id,
        priority: item.priority,
        fields: item.fields,
        requiresApproval: item.requiresApproval,
        approverIds: approvers.map((a) => a.id),
        order,
      },
    });
    report.catalogItems++;
  }
}

async function syncOrganizations(tx: Tx, cfg: BusinessConfig, report: SyncReport) {
  for (const org of cfg.organizations) {
    const existing = await tx.organization.findUnique({ where: { slug: org.slug } });
    if (existing) continue;
    await tx.organization.create({ data: { name: org.name, slug: org.slug, domains: org.domains.map((d) => d.toLowerCase()) } });
    report.organizations++;
  }
}
