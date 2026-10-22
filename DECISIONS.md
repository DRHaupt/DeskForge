# Design decisions

A running log of choices made while building DeskForge, especially where the
requirements were ambiguous. Newest entries at the bottom of each phase.

## Phase 1 — Foundation

### D-001 · Stack versions
Next.js 16 (App Router, `proxy.ts` instead of `middleware.ts`), React 19, Prisma 7
with the `@prisma/adapter-pg` driver adapter (Prisma 7 no longer ships a Rust
query engine), Auth.js v5 (`next-auth@5` beta, the App Router–native release),
Zod 4, BullMQ 6 + ioredis, Tailwind CSS 4, Vitest 5, Playwright. The npm
`latest` tag for `prisma` pointed at an 8.0 release candidate, so the CLI is
pinned to 7.10.1 to match `@prisma/client`.

### D-002 · shadcn/ui components are vendored by hand
The shadcn registry (ui.shadcn.com) was unreachable from the build environment,
so the components in `src/components/ui` were written by hand in the same style
(Radix primitives + `class-variance-authority` + Tailwind). They are plain
source files you own, exactly as with the shadcn CLI, and `components.json` is
in place so `npx shadcn add <component>` works later where the registry is
reachable.

### D-003 · Config is validated twice: at boot and at container start
`src/instrumentation.ts` validates env + `business.config.yaml` when Next.js
starts and exits with a readable error. The Docker entrypoint also runs
`scripts/check-config.ts` before migrations, so a typo never reaches the
database. All cross-references (states in transitions, teams in routing,
priority matrix completeness, feature flags vs ticket types) are checked with
exact YAML paths in the error, e.g.
`ticketTypes[0].workflow.transitions[3].to: unknown state "resloved"`.

### D-004 · Multi-tenant readiness
Every table has a nullable `tenant_id`, always `NULL` in single-tenant mode.
Turning on multi-tenant mode later means: (1) a `Tenant` table and non-null
`tenant_id`, (2) a Prisma client extension that injects `tenant_id` into every
query (all DB access already goes through `src/server/db.ts`), (3) per-tenant
config (the loader already returns a value object rather than reading globals
ad hoc), and (4) changing unique keys such as `users.email` and
`tickets.number` to composite `(tenant_id, …)` keys. Postgres treats NULLs as
distinct in unique indexes, so these uniques are global for now — correct for
single-tenant. `MULTI_TENANT=true` is rejected at startup until this lands.

### D-005 · Business values are strings, product values are enums
Statuses, priorities, impact and urgency come from config, so they are stored
as string keys. Each status also stores its `status_category`
(new/open/pending/resolved/closed) so reports, SLAs and the portal work the
same across businesses with different workflows. Fixed product concepts
(comment visibility, ticket source, SLA metric, relationship type) are Postgres
enums.

### D-006 · Who owns what: config vs admin UI
- **Config-owned, re-synced on every start:** ticket types and their custom
  fields, SLA policies, categories. Entries removed from config are
  *deactivated*, never deleted, so historic tickets keep their data.
- **Bootstrap-only (created if missing, then owned by the admin UI):** roles,
  teams, catalog items, organizations. Admins edit these in the UI and a
  restart does not overwrite their changes.
- **Team members in config** are applied once per (team, email) pair, including
  when a listed person signs in for the first time. If an admin later removes
  them in the UI, the next sync does not add them back.

The sync runs under a Postgres advisory lock so several containers can start at
once.

### D-007 · Sessions are thin; permissions are read fresh
Auth.js uses JWT sessions (required for the credentials provider) that hold only
the user id and a `session_version`. Roles, permissions and team memberships
are loaded from the database for each request (`getCurrentActor`, cached per
request). Role edits apply immediately, and deactivating a user, resetting 2FA
or an admin password reset bumps `session_version`, which ends existing
sessions.

### D-008 · Authorization lives in services, not only routes
Every API route goes through `apiRoute()` (`src/server/api.ts`), which requires a
permission, validates params/query/body with Zod, checks `Origin` on
cookie-authenticated mutations (CSRF), rate-limits, and maps errors to JSON.
The service functions it calls *also* check permissions, so scripts, the
worker and future entry points can't bypass them. Pages use
`requirePagePermission()` for the same checks before rendering.

### D-009 · No privilege escalation
Users can only grant roles whose permissions they hold themselves, edit users
whose permissions they hold, and add permissions to roles that they hold. The
last active full admin cannot be deactivated or demoted. API keys are capped by
their creator's *current* permissions, and stop working when the creator is
deactivated.

### D-010 · Full-text search = Postgres `tsvector` maintained by triggers
`search_vector` columns on tickets, comments and articles are kept up to date by
triggers defined in the initial migration (weighted: number/title > body). The
app never writes them, and they are declared as `Unsupported("tsvector")` in
Prisma (with GIN indexes) so migrations don't drift. The text search config is
`english`; for other languages, add a migration that redefines the three
trigger functions. Searching is behind a `SearchProvider` interface so
Meilisearch can be swapped in (Phase 2).

### D-011 · Audit log
Every successful mutating API call is audited. Admin services write richer
entries themselves (field-level diffs, with secrets removed), and those routes
skip the generic entry (`skipAudit`). Sign-ins, failed sign-ins and lockouts are
audited as `auth.*` system events. Audit writes never fail the user's action,
but failures are logged at error level.

### D-012 · Passwords and 2FA without native modules
Passwords are hashed with `bcryptjs` (cost 12). It is pure JavaScript, so the
Docker image needs no native build toolchain. TOTP is implemented directly
(RFC 6238, verified against the RFC test vectors) rather than through a
dependency, and TOTP secrets are encrypted at rest with AES-256-GCM, using a key
derived from `AUTH_SECRET`. Failed logins lock the account for
`auth.local.lockoutMinutes` after `maxFailedAttempts`.

### D-013 · One image, two processes
The same Docker image runs the web app (`web`) and the BullMQ worker
(`worker`). The image carries full `node_modules` instead of Next's
`standalone` output, because the worker and the migration step need Prisma's
CLI and `tsx`. Config (`business.config.yaml`), branding and uploads are
volumes; nothing business-specific is baked into the image. The web container
applies migrations and syncs config on start, and the worker waits for the web
container to be healthy.

### D-014 · First admin
On a fresh install with no admin, the startup sync creates one from
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (the password must meet the
configured policy). `scripts/new-business.sh` generates both. Demo data is
opt-in (`SEED_DEMO_DATA=true`) and runs once (tracked in `system_settings`).

### D-015 · Branding assets are served from a mounted folder
`/branding/<file>` serves files from `BRANDING_DIR` with path-traversal
protection. SVGs are served with a sandboxing CSP so an uploaded logo can't run
script. Colors come from config and are injected as CSS variables. The text
color on the primary brand color is picked automatically for WCAG contrast,
unless `branding.colors.primaryForeground` is set.

### D-016 · Content Security Policy with per-request nonces
`src/proxy.ts` issues a nonce-based CSP for every page (scripts must carry the
nonce; `strict-dynamic`). Inline *styles* are allowed because UI primitives
position popovers with style attributes. Other headers (HSTS when the base URL
is https, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy,
Permissions-Policy) come from `next.config.ts`.

## Phase 2 — Ticketing core

### D-017 · Who sees which tickets
- `ticket.view_all` (team leads, auditors, admins): everything.
- `ticket.view_team` (agents): tickets in their teams' queues, tickets with **no
  team** (the triage pile), and tickets assigned to them.
- `ticket.view_own` (requesters): tickets they requested or watch.
- `ticket.view_org`, or the per-user "org ticket access" flag: everything from
  their organization.

The rule exists twice, once as a pure function (`core/tickets/access.ts`) and
once as a Prisma `where` (`services/ticket-access.ts`), and tests cover both.
Tickets the actor can't see return **404, not 403**, so their existence doesn't
leak.

### D-018 · Ticket numbers
Each ticket type has its own counter, `ticket_types.next_number`, incremented
with a single `UPDATE … RETURNING` inside the creating transaction. This means
no gaps under concurrency, other than rolled-back creates. Numbers are
`<prefix><zero-padded counter>`, with padding set per type in config.

### D-019 · Workflow enforcement
Every status change goes through `resolveTransition()`. A transition must exist
in config, and the actor must hold one of its roles. The `requester` role only
counts for the ticket's own requester. Full admins may perform any
*configured* transition, but never an unconfigured one. Automations and other
internal callers act as the system actor. `requireComment` is enforced on the
server. Merging is the one deliberate bypass (see D-021).

### D-020 · Requester replies move the ticket back into the queue
A public reply from the requester on a *pending* or *resolved* ticket triggers a
system transition to `portal.reopenStatus`, if the workflow has a transition
from the current state. Reopening increments `reopen_count` and clears
`resolved_at`.

### D-021 · Merging
Merging A into B moves A's comments and attachments to B, adds A's requester
and watchers to B as watchers, closes A in the first `closed` state of its
workflow (bypassing transition rules), sets `merged_into_id`, and records a
`DUPLICATE_OF` link. Both tickets get a system comment.

### D-022 · Timeline
The ticket timeline merges comments, status history and selected audit entries
(field changes, assignment, links, merges). Requesters see only public comments
and status changes.

### D-023 · Rich text and mentions
The editor is Tiptap. Every HTML body (editor, email, API) is sanitized
server-side with an allow-list (`src/server/richtext.ts`), and a plain-text copy
is stored for search and email. Mentions are `<span data-type="mention"
data-id>` nodes. Only agents can be mentioned, and mentioned agents become
watchers.

### D-024 · Attachments
Files are uploaded first (`POST /api/v1/attachments`) and then referenced by id
when creating a ticket or comment. Uploads that aren't linked yet are visible
only to their uploader. Downloads re-check ticket visibility and internal-note
visibility. Limits are `UPLOAD_MAX_MB` plus a MIME/extension allow-list.
Executables, scripts, HTML and SVG are always blocked. Files are served with
`nosniff` and a sandboxing CSP. Storage keys are random, and the original
filename lives only in the database.

### D-025 · Assignment permissions
`ticket.assign` lets an agent take a ticket, release it, or move it within their
own teams. `ticket.reassign` (team leads) allows any team or agent. Moving a
ticket to another team without naming a person lets that team's strategy
(round-robin / load-balanced / manual) pick someone. Round-robin locks the team
row (`SELECT … FOR UPDATE`) so parallel creates spread fairly.

### D-026 · Search
`PostgresSearchProvider` builds a prefix `tsquery` from the user's words
(`batt swoll` matches "battery swelling"), ranks ticket and comment hits, and
gives an exact ticket-number match the top spot. It then filters results through
the same visibility `where` clause, and excludes internal notes for requesters.
Snippets come from `ts_headline`, with markers that the UI renders as `<mark>`
without injecting HTML.

### D-027 · Bulk actions reuse the single-ticket path
Bulk updates call the same service functions one ticket at a time, so every
workflow, permission and audit rule applies, and the result lists per-ticket
failures instead of failing the whole batch.
