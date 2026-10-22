/**
 * Zod schema for business.config.yaml.
 *
 * Everything that differs between businesses is described here. The loader
 * validates the file at startup and refuses to boot on errors. Cross-reference
 * checks (e.g. "workflow transition points at an unknown state") live in
 * `superRefine` at the bottom, so error messages carry the exact YAML path.
 *
 * Keep docs/CONFIG-REFERENCE.md in sync with this file.
 */
import { z } from "zod";

// ─── Primitives ────────────────────────────────────────────────────────────

/** Lowercase identifier used as a stable key: letters, digits, underscores, dashes. */
export const keySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]*$/, "must be lowercase letters, digits, '_' or '-', starting with a letter");

const hexColor = z.string().regex(/^#([0-9a-fA-F]{6})$/, "must be a 6-digit hex color like #2563eb");

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM (24h)");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

/**
 * Duration in minutes. Accepts a number of minutes, or a string such as
 * "30m", "4h", "2d", "1h30m". Days are 24h (calendar) units; business-hour
 * SLAs interpret them against the business calendar.
 */
export const durationSchema = z.union([z.number().int().positive(), z.string()]).transform((v, ctx) => {
  if (typeof v === "number") return v;
  const m = v.trim().match(/^(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?$/i);
  if (!m || (!m[1] && !m[2] && !m[3])) {
    ctx.addIssue({ code: "custom", message: `invalid duration "${v}" (use e.g. 30m, 4h, 2d, 1h30m)` });
    return z.NEVER;
  }
  const mins = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  if (mins <= 0) {
    ctx.addIssue({ code: "custom", message: "duration must be greater than zero" });
    return z.NEVER;
  }
  return mins;
});

const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: "must be a valid IANA time zone, e.g. America/New_York" },
);

// ─── Branding ──────────────────────────────────────────────────────────────

export const brandingSchema = z.object({
  name: z.string().min(1),
  /** Short name used in tight spaces (browser tab, mobile header). */
  shortName: z.string().optional(),
  /** Path relative to the branding directory (BRANDING_DIR), or an absolute https URL. */
  logo: z.string().optional(),
  favicon: z.string().optional(),
  colors: z
    .object({
      primary: hexColor.default("#2563eb"),
      accent: hexColor.default("#0ea5e9"),
      /** Optional: text color on top of primary. Computed for contrast if omitted. */
      primaryForeground: hexColor.optional(),
    })
    .prefault({}),
  supportEmail: z.email(),
  supportPhone: z.string().optional(),
  portalWelcome: z.string().default("How can we help you today?"),
  footer: z.string().default(""),
});

// ─── Locale & calendar ─────────────────────────────────────────────────────

const timeRange = z
  .object({ start: hhmm, end: hhmm })
  .refine((r) => r.start < r.end, { message: "start must be before end" });

const dayHours = z.array(timeRange).default([]);

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const localeSchema = z.object({
  timezone: timezoneSchema.default("UTC"),
  language: z.string().default("en"),
  dateFormat: z.string().default("yyyy-MM-dd"),
  timeFormat: z.string().default("HH:mm"),
  weekStartsOn: z.enum(WEEKDAYS).default("mon"),
  businessHours: z
    .object({
      mon: dayHours,
      tue: dayHours,
      wed: dayHours,
      thu: dayHours,
      fri: dayHours,
      sat: dayHours,
      sun: dayHours,
    })
    .prefault({
      mon: [{ start: "09:00", end: "17:00" }],
      tue: [{ start: "09:00", end: "17:00" }],
      wed: [{ start: "09:00", end: "17:00" }],
      thu: [{ start: "09:00", end: "17:00" }],
      fri: [{ start: "09:00", end: "17:00" }],
    }),
  holidays: z.array(z.object({ date: isoDate, name: z.string() })).default([]),
});

// ─── Auth ──────────────────────────────────────────────────────────────────

export const OIDC_PROVIDER_TYPES = ["microsoft-entra-id", "google", "generic"] as const;

export const authSchema = z
  .object({
    local: z
      .object({
        enabled: z.boolean().default(true),
        passwordPolicy: z
          .object({
            minLength: z.number().int().min(8).default(12),
            requireUppercase: z.boolean().default(true),
            requireLowercase: z.boolean().default(true),
            requireNumber: z.boolean().default(true),
            requireSymbol: z.boolean().default(false),
          })
          .prefault({}),
        maxFailedAttempts: z.number().int().min(1).default(5),
        lockoutMinutes: z.number().int().min(1).default(15),
      })
      .prefault({}),
    oidc: z
      .array(
        z.object({
          /** Provider id used in callback URLs: /api/auth/callback/<id>. */
          id: keySchema,
          type: z.enum(OIDC_PROVIDER_TYPES),
          /** Button label on the login page. */
          label: z.string(),
          /**
           * Prefix of env vars that hold the secrets. E.g. "OIDC_ENTRA" reads
           * OIDC_ENTRA_CLIENT_ID, OIDC_ENTRA_CLIENT_SECRET, OIDC_ENTRA_ISSUER.
           */
          envPrefix: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
          /** Create a local user on first sign-in if none exists. */
          autoProvision: z.boolean().default(true),
          /** Role given to auto-provisioned users. */
          defaultRole: keySchema.default("requester"),
          /** Only allow these email domains (empty = any). */
          allowedDomains: z.array(z.string()).default([]),
        }),
      )
      .default([]),
    sessionMaxAgeHours: z.number().int().min(1).default(12),
    /** Roles that must enrol in TOTP two-factor auth. */
    requireTwoFactorForRoles: z.array(keySchema).default([]),
  })
  .prefault({});

// ─── Portal ────────────────────────────────────────────────────────────────

export const portalSchema = z
  .object({
    /** Default for new requesters: can they see their whole organization's tickets? */
    requestersSeeOrgTickets: z.boolean().default(false),
    /** Requesters can close their own tickets from the portal. */
    allowRequesterClose: z.boolean().default(true),
    /** Status a requester's close action moves the ticket to. */
    requesterCloseStatus: keySchema.default("closed"),
    /** Reopen a resolved ticket when the requester replies. */
    reopenOnReply: z.boolean().default(true),
    /** Status a reopened ticket goes to. */
    reopenStatus: keySchema.default("open"),
    /** Suggest knowledge base articles while a requester types a new ticket. */
    suggestArticles: z.boolean().default(true),
  })
  .prefault({});

// ─── Priorities ────────────────────────────────────────────────────────────

const levelSchema = z.object({
  key: keySchema,
  name: z.string(),
  color: hexColor.optional(),
});

export const prioritiesSchema = z.object({
  /** Ordered from most to least urgent. */
  levels: z.array(levelSchema).min(1),
  impact: z.array(levelSchema).min(1),
  urgency: z.array(levelSchema).min(1),
  /** matrix[impact][urgency] = priority key */
  matrix: z.record(z.string(), z.record(z.string(), keySchema)),
  default: keySchema,
});

// ─── SLA ───────────────────────────────────────────────────────────────────

export const slaSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** Statuses that pause every SLA timer unless a policy overrides it. */
    pauseStatuses: z.array(keySchema).default([]),
    /** Send a warning when this % of the target has elapsed. */
    warningPercent: z.number().int().min(1).max(99).default(80),
    policies: z
      .array(
        z.object({
          key: keySchema,
          name: z.string(),
          priorities: z.array(keySchema).min(1),
          /** Restrict to these ticket types (empty = all). */
          ticketTypes: z.array(keySchema).default([]),
          firstResponse: durationSchema.optional(),
          resolution: durationSchema.optional(),
          /** business = only count business hours; always = 24/7. */
          calendar: z.enum(["business", "always"]).default("business"),
          /** Overrides sla.pauseStatuses for this policy. */
          pauseStatuses: z.array(keySchema).optional(),
        }),
      )
      .default([]),
    escalation: z
      .object({
        /** On warning: notify assignee and team leads. */
        notifyOnWarning: z.boolean().default(true),
        /** On breach: notify the team's escalation target. */
        notifyOnBreach: z.boolean().default(true),
        /** On breach: reassign the ticket to the team's escalation team. */
        reassignOnBreach: z.boolean().default(false),
        /** On breach: bump priority one level up. */
        raisePriorityOnBreach: z.boolean().default(false),
      })
      .prefault({}),
  })
  .prefault({});

// ─── Teams ─────────────────────────────────────────────────────────────────

export const teamSchema = z.object({
  key: keySchema,
  name: z.string(),
  description: z.string().optional(),
  email: z.email().optional(),
  assignment: z.enum(["round_robin", "load_balanced", "manual"]).default("manual"),
  /**
   * Initial members by email. Only applied when the team is first created;
   * after that, membership is managed in the admin UI. See DECISIONS.md D-006.
   */
  members: z.array(z.email()).default([]),
  leads: z.array(z.email()).default([]),
  escalateTo: z
    .object({
      team: keySchema.optional(),
      user: z.email().optional(),
    })
    .optional(),
});

// ─── Categories ────────────────────────────────────────────────────────────

export type CategoryInput = { key: string; name: string; children?: CategoryInput[] };

export const categorySchema: z.ZodType<CategoryInput> = z.lazy(() =>
  z.object({
    key: keySchema,
    name: z.string(),
    children: z.array(categorySchema).optional(),
  }),
);

// ─── Ticket types ──────────────────────────────────────────────────────────

export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "dropdown",
  "multiselect",
  "date",
  "user",
  "asset",
  "checkbox",
] as const;

const optionSchema = z.union([
  z.string().transform((s) => ({ value: s, label: s })),
  z.object({ value: z.string(), label: z.string() }),
]);

export const fieldSchema = z
  .object({
    key: keySchema,
    label: z.string(),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    options: z.array(optionSchema).optional(),
    helpText: z.string().optional(),
    /** Shown on the customer portal form. */
    portal: z.boolean().default(true),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .refine((f) => !["dropdown", "multiselect"].includes(f.type) || (f.options && f.options.length > 0), {
    message: "dropdown and multiselect fields need at least one option",
    path: ["options"],
  });

export const STATUS_CATEGORIES = ["new", "open", "pending", "resolved", "closed"] as const;

export const workflowSchema = z.object({
  initial: keySchema,
  states: z
    .array(
      z.object({
        key: keySchema,
        name: z.string(),
        /** Groups states for reporting, SLA and portal display. */
        category: z.enum(STATUS_CATEGORIES),
        /** Pauses SLA timers while in this state (in addition to sla.pauseStatuses). */
        pausesSla: z.boolean().default(false),
        /** Label shown to requesters in the portal (defaults to name). */
        portalName: z.string().optional(),
        color: hexColor.optional(),
      }),
    )
    .min(1),
  transitions: z
    .array(
      z.object({
        from: z.union([keySchema, z.literal("*"), z.array(keySchema)]).transform((v) => (Array.isArray(v) ? v : [v])),
        to: keySchema,
        /** Button label, e.g. "Start work". */
        name: z.string().optional(),
        /** Role keys allowed to perform this transition. "*" = any role with ticket.transition. */
        roles: z.array(z.union([keySchema, z.literal("*")])).default(["*"]),
        requireComment: z.boolean().default(false),
      }),
    )
    .default([]),
});

export const ticketTypeSchema = z.object({
  key: keySchema,
  name: z.string(),
  description: z.string().optional(),
  /** Uppercase letters, used in ticket numbers, e.g. INC → INC0001042. */
  prefix: z.string().regex(/^[A-Z]{2,6}$/, "must be 2-6 uppercase letters"),
  numberPadding: z.number().int().min(3).max(12).default(7),
  icon: z.string().optional(),
  defaultPriority: keySchema.optional(),
  defaultTeam: keySchema.optional(),
  /** Requesters may submit this type from the portal. */
  portalVisible: z.boolean().default(true),
  /** Module this type belongs to; hidden when that feature flag is off. */
  feature: z.enum(["problemManagement", "changeManagement"]).optional(),
  fields: z.array(fieldSchema).default([]),
  workflow: workflowSchema,
});

// ─── Email ─────────────────────────────────────────────────────────────────

export const emailSchema = z
  .object({
    enabled: z.boolean().default(false),
    fromName: z.string().optional(),
    /** Defaults to branding.supportEmail. */
    fromAddress: z.email().optional(),
    /** Inbound mailboxes. Each maps to a team and ticket type. */
    mailboxes: z
      .array(
        z.object({
          address: z.email(),
          team: keySchema.optional(),
          ticketType: keySchema,
          /** "imap" polls a mailbox; "webhook" accepts provider POSTs at /api/inbound/email. */
          mode: z.enum(["imap", "webhook"]).default("imap"),
          /** Env var prefix for IMAP credentials, e.g. IMAP_SUPPORT → IMAP_SUPPORT_HOST, _PORT, _USER, _PASSWORD, _TLS. */
          imapEnvPrefix: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
          pollSeconds: z.number().int().min(15).default(60),
        }),
      )
      .default([]),
    /** Create requester accounts for unknown senders. If false, unknown senders are ignored. */
    createUnknownSenders: z.boolean().default(true),
    /** Senders matching these patterns are ignored (auto-replies, no-reply addresses). */
    ignoreSenders: z.array(z.string()).default(["mailer-daemon@*", "no-reply@*", "noreply@*"]),
  })
  .prefault({});

// ─── Features ──────────────────────────────────────────────────────────────

export const featuresSchema = z
  .object({
    knowledgeBase: z.boolean().default(true),
    serviceCatalog: z.boolean().default(true),
    assets: z.boolean().default(false),
    problemManagement: z.boolean().default(false),
    changeManagement: z.boolean().default(false),
    agileBoards: z.boolean().default(false),
    csat: z.boolean().default(false),
    publicSignup: z.boolean().default(false),
  })
  .prefault({});

export const csatSchema = z
  .object({
    /** Send the survey when a ticket enters a state in this category. */
    sendOn: z.enum(["resolved", "closed"]).default("resolved"),
    delayMinutes: z.number().int().min(0).default(0),
    scale: z.union([z.literal(3), z.literal(5)]).default(5),
    question: z.string().default("How satisfied were you with the support you received?"),
  })
  .prefault({});

// ─── Optional seed-like content ────────────────────────────────────────────

export const catalogItemSchema = z.object({
  key: keySchema,
  name: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  group: z.string().optional(),
  ticketType: keySchema,
  team: keySchema.optional(),
  priority: keySchema.optional(),
  requiresApproval: z.boolean().default(false),
  /** Approver emails. Empty = anyone with catalog.approve. */
  approvers: z.array(z.email()).default([]),
  fields: z.array(fieldSchema).default([]),
});

export const organizationSeedSchema = z.object({
  name: z.string(),
  slug: keySchema,
  domains: z.array(z.string()).default([]),
});

export const boardSchema = z.object({
  key: keySchema,
  name: z.string(),
  ticketTypes: z.array(keySchema).min(1),
  team: keySchema.optional(),
  /** Each column groups one or more workflow states. Dropping a card moves it to the first state. */
  columns: z.array(z.object({ name: z.string(), states: z.array(keySchema).min(1), wipLimit: z.number().int().optional() })).min(1),
});

// ─── Root ──────────────────────────────────────────────────────────────────

export const businessConfigSchema = z
  .object({
    version: z.literal(1),
    branding: brandingSchema,
    locale: localeSchema.prefault({}),
    auth: authSchema,
    portal: portalSchema,
    features: featuresSchema,
    priorities: prioritiesSchema,
    sla: slaSchema,
    teams: z.array(teamSchema).default([]),
    categories: z.array(categorySchema).default([]),
    ticketTypes: z.array(ticketTypeSchema).min(1),
    email: emailSchema,
    csat: csatSchema,
    catalog: z.array(catalogItemSchema).default([]),
    organizations: z.array(organizationSeedSchema).default([]),
    boards: z.array(boardSchema).default([]),
    /** Problem/change specific options. */
    itsm: z
      .object({
        riskLevels: z.array(levelSchema).default([
          { key: "low", name: "Low" },
          { key: "medium", name: "Medium" },
          { key: "high", name: "High" },
        ]),
        /** Users (emails) on the change advisory board. */
        cabMembers: z.array(z.email()).default([]),
        /** Number of approvals a change needs. */
        cabQuorum: z.number().int().min(1).default(1),
        /** Risk levels that require CAB approval. */
        cabRequiredForRisk: z.array(keySchema).default(["medium", "high"]),
      })
      .prefault({}),
  })
  .superRefine((cfg, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const dupes = (keys: string[]) => keys.filter((k, i) => keys.indexOf(k) !== i);

    const priorityKeys = new Set(cfg.priorities.levels.map((l) => l.key));
    const teamKeys = new Set(cfg.teams.map((t) => t.key));
    const typeKeys = new Set(cfg.ticketTypes.map((t) => t.key));

    // Unique keys
    for (const [path, keys] of [
      [["priorities", "levels"], cfg.priorities.levels.map((l) => l.key)],
      [["teams"], cfg.teams.map((t) => t.key)],
      [["ticketTypes"], cfg.ticketTypes.map((t) => t.key)],
      [["sla", "policies"], cfg.sla.policies.map((p) => p.key)],
      [["catalog"], cfg.catalog.map((c) => c.key)],
    ] as const) {
      for (const d of dupes([...keys])) issue([...path], `duplicate key "${d}"`);
    }
    for (const d of dupes(cfg.ticketTypes.map((t) => t.prefix))) issue(["ticketTypes"], `duplicate prefix "${d}"`);

    // Priority matrix must be complete and reference real priorities
    if (!priorityKeys.has(cfg.priorities.default)) issue(["priorities", "default"], `unknown priority "${cfg.priorities.default}"`);
    for (const imp of cfg.priorities.impact) {
      const row = cfg.priorities.matrix[imp.key];
      if (!row) {
        issue(["priorities", "matrix", imp.key], `missing row for impact "${imp.key}"`);
        continue;
      }
      for (const urg of cfg.priorities.urgency) {
        const p = row[urg.key];
        if (!p) issue(["priorities", "matrix", imp.key, urg.key], `missing priority for impact "${imp.key}" × urgency "${urg.key}"`);
        else if (!priorityKeys.has(p)) issue(["priorities", "matrix", imp.key, urg.key], `unknown priority "${p}"`);
      }
    }

    // SLA policies
    cfg.sla.policies.forEach((p, i) => {
      p.priorities.forEach((k, j) => {
        if (!priorityKeys.has(k)) issue(["sla", "policies", i, "priorities", j], `unknown priority "${k}"`);
      });
      p.ticketTypes.forEach((k, j) => {
        if (!typeKeys.has(k)) issue(["sla", "policies", i, "ticketTypes", j], `unknown ticket type "${k}"`);
      });
      if (p.firstResponse === undefined && p.resolution === undefined)
        issue(["sla", "policies", i], "policy needs firstResponse and/or resolution");
    });

    // Teams
    cfg.teams.forEach((t, i) => {
      if (t.escalateTo?.team && !teamKeys.has(t.escalateTo.team))
        issue(["teams", i, "escalateTo", "team"], `unknown team "${t.escalateTo.team}"`);
      if (t.escalateTo?.team === t.key) issue(["teams", i, "escalateTo", "team"], "a team cannot escalate to itself");
    });

    // Ticket types & workflows
    const allStateKeys = new Set<string>();
    cfg.ticketTypes.forEach((t, i) => {
      const states = new Set(t.workflow.states.map((s) => s.key));
      t.workflow.states.forEach((s) => allStateKeys.add(s.key));
      for (const d of dupes(t.workflow.states.map((s) => s.key))) issue(["ticketTypes", i, "workflow", "states"], `duplicate state "${d}"`);
      for (const d of dupes(t.fields.map((f) => f.key))) issue(["ticketTypes", i, "fields"], `duplicate field "${d}"`);
      if (!states.has(t.workflow.initial)) issue(["ticketTypes", i, "workflow", "initial"], `unknown state "${t.workflow.initial}"`);
      t.workflow.transitions.forEach((tr, j) => {
        tr.from.forEach((f) => {
          if (f !== "*" && !states.has(f)) issue(["ticketTypes", i, "workflow", "transitions", j, "from"], `unknown state "${f}"`);
        });
        if (!states.has(tr.to)) issue(["ticketTypes", i, "workflow", "transitions", j, "to"], `unknown state "${tr.to}"`);
      });
      if (t.defaultPriority && !priorityKeys.has(t.defaultPriority))
        issue(["ticketTypes", i, "defaultPriority"], `unknown priority "${t.defaultPriority}"`);
      if (t.defaultTeam && !teamKeys.has(t.defaultTeam)) issue(["ticketTypes", i, "defaultTeam"], `unknown team "${t.defaultTeam}"`);
    });

    cfg.sla.pauseStatuses.forEach((s, i) => {
      if (!allStateKeys.has(s)) issue(["sla", "pauseStatuses", i], `"${s}" is not a state in any workflow`);
    });

    // Email routing
    cfg.email.mailboxes.forEach((m, i) => {
      if (!typeKeys.has(m.ticketType)) issue(["email", "mailboxes", i, "ticketType"], `unknown ticket type "${m.ticketType}"`);
      if (m.team && !teamKeys.has(m.team)) issue(["email", "mailboxes", i, "team"], `unknown team "${m.team}"`);
      if (m.mode === "imap" && !m.imapEnvPrefix) issue(["email", "mailboxes", i, "imapEnvPrefix"], "required when mode is imap");
    });

    // Catalog
    cfg.catalog.forEach((c, i) => {
      if (!typeKeys.has(c.ticketType)) issue(["catalog", i, "ticketType"], `unknown ticket type "${c.ticketType}"`);
      if (c.team && !teamKeys.has(c.team)) issue(["catalog", i, "team"], `unknown team "${c.team}"`);
      if (c.priority && !priorityKeys.has(c.priority)) issue(["catalog", i, "priority"], `unknown priority "${c.priority}"`);
    });

    // Boards
    cfg.boards.forEach((b, i) => {
      b.ticketTypes.forEach((k, j) => {
        if (!typeKeys.has(k)) issue(["boards", i, "ticketTypes", j], `unknown ticket type "${k}"`);
      });
      b.columns.forEach((c, j) =>
        c.states.forEach((s, k) => {
          if (!allStateKeys.has(s)) issue(["boards", i, "columns", j, "states", k], `unknown state "${s}"`);
        }),
      );
    });

    // Features vs types
    cfg.ticketTypes.forEach((t, i) => {
      if (t.feature && !cfg.features[t.feature])
        issue(["ticketTypes", i, "feature"], `type "${t.key}" belongs to ${t.feature}, but features.${t.feature} is false (remove the type or enable the feature)`);
    });
  });

export type BusinessConfigInput = z.input<typeof businessConfigSchema>;
export type BusinessConfig = z.output<typeof businessConfigSchema>;
export type TicketTypeConfig = BusinessConfig["ticketTypes"][number];
export type WorkflowConfig = TicketTypeConfig["workflow"];
export type WorkflowState = WorkflowConfig["states"][number];
export type WorkflowTransition = WorkflowConfig["transitions"][number];
export type FieldConfig = TicketTypeConfig["fields"][number];
export type TeamConfig = BusinessConfig["teams"][number];
export type SlaPolicyConfig = BusinessConfig["sla"]["policies"][number];
export type FeatureFlags = BusinessConfig["features"];
export type FeatureName = keyof FeatureFlags;
