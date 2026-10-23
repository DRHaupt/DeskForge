# Configuration reference

Each DeskForge deployment is configured with two files:

| File | Holds | Committed? |
|---|---|---|
| `.env` | Secrets and infrastructure: database, Redis, SMTP, OIDC client secrets, storage keys | **Never** |
| `business.config.yaml` | Everything else about the business: branding, hours, priorities, SLAs, teams, ticket types, workflows, email routing, catalog, boards | Yes (in your deployment repo) |

The YAML file is validated with Zod when the app, the worker or `npm run config:check` starts.
If anything is wrong, the app refuses to start and prints the exact path
(for example `ticketTypes.0.workflow.transitions.3.to: unknown state "closd"`).
The schema itself is `src/core/config/schema.ts`; this page describes it.

Three complete examples live in `examples/`:

- `msp-it-support.yaml`: managed service provider with client organizations, ITIL-style workflow, problem/change management and a CAB.
- `internal-it.yaml`: small internal IT team, assets, an agile board, Google sign-in.
- `ecommerce-support.yaml`: online shop customer service, order/return types, CSAT, public sign-up.

Start from the closest one: `scripts/new-business.sh <name> <example>`.

---

## Conventions

- **Keys** (`key:` fields, state keys, team keys and so on) are lowercase letters, digits, `_` and `-`, starting with a letter. They are stored in the database, so **don't rename keys once you have data**. Change the `name:` instead.
- **Durations** accept minutes as a number or a string: `30m`, `4h`, `2d`, `1h30m`.
- **Colors** are 6-digit hex: `#2563eb`.
- **Time zones** are IANA names: `Europe/London`, `America/New_York`.

### What happens on restart

| Section | Behaviour when you change it and restart |
|---|---|
| ticket types, fields, workflows, SLA policies, categories, priorities | **Synced every start.** Config is the source of truth. Removed items are deactivated, not deleted, so history stays intact. |
| roles, teams, catalog items, organizations | **Created once** (bootstrap). After that they're edited in the admin UI, and later YAML changes to existing ones are ignored (team members only get *added*). See `DECISIONS.md` D-006. |

Run `npm run config:check` to validate without starting, and `npm run config:sync` to apply without a restart.

---

## `version`

Always `1`.

## `branding`

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | **required** | Shown everywhere: header, emails, page titles. |
| `shortName` | string | `name` | Used in tight spaces (browser tab, mobile header). |
| `logo` | path or https URL | none | Path relative to `BRANDING_DIR` (default `./branding`), served at `/branding/...`. SVG or PNG. |
| `favicon` | path or https URL | built-in | |
| `colors.primary` | hex | `#2563eb` | Buttons, links, focus rings. |
| `colors.accent` | hex | `#0ea5e9` | Highlights. |
| `colors.primaryForeground` | hex | computed | Text on primary. Picked automatically for contrast if omitted. |
| `supportEmail` | email | **required** | Reply-to and default "from" address. |
| `supportPhone` | string | none | Shown in the portal footer. |
| `portalWelcome` | string | `How can we help you today?` | Portal home heading. |
| `footer` | string | empty | Portal footer text. |

## `locale`

| Field | Default | Notes |
|---|---|---|
| `timezone` | `UTC` | Business time zone. Used for business hours, SLA clocks, reports and date display. |
| `language` | `en` | UI language tag (English UI today). |
| `dateFormat` / `timeFormat` | `yyyy-MM-dd` / `HH:mm` | Display hints. |
| `weekStartsOn` | `mon` | |
| `businessHours.<mon…sun>` | Mon–Fri 09:00–17:00 | List of `{ start, end }` ranges per day. Several ranges allow lunch breaks; an empty list means closed. |
| `holidays` | `[]` | `{ date: YYYY-MM-DD, name }`. Business-hours SLAs don't run on these days. |

## `auth`

| Field | Default | Notes |
|---|---|---|
| `local.enabled` | `true` | Email and password sign-in. |
| `local.passwordPolicy.minLength` | `12` | Minimum 8. |
| `local.passwordPolicy.requireUppercase / requireLowercase / requireNumber / requireSymbol` | `true / true / true / false` | |
| `local.maxFailedAttempts` | `5` | Wrong passwords **and** wrong 2FA codes count. |
| `local.lockoutMinutes` | `15` | |
| `oidc[]` | `[]` | Single sign-on providers (see below). |
| `sessionMaxAgeHours` | `12` | |
| `requireTwoFactorForRoles` | `[]` | Role keys that must enrol in TOTP. Users with a password and one of these roles are sent to set it up before they can use anything else. Single-sign-on-only users are exempt: their identity provider handles MFA. |

Sign-in is also rate-limited to 20 attempts per minute per IP and 10 per account.

### `auth.oidc[]`

| Field | Default | Notes |
|---|---|---|
| `id` | **required** | Used in the callback URL `https://<host>/api/auth/callback/<id>`. |
| `type` | **required** | `microsoft-entra-id`, `google` or `generic`. |
| `label` | **required** | Button text, e.g. "Sign in with Microsoft". |
| `envPrefix` | **required** | Reads `<PREFIX>_CLIENT_ID`, `<PREFIX>_CLIENT_SECRET` and `<PREFIX>_ISSUER` (needed for Entra and generic) from `.env`. The button only appears when the ID and secret are set. |
| `autoProvision` | `true` | Create a user on first sign-in. If false, only existing users (matched by email) can sign in. |
| `defaultRole` | `requester` | Role for auto-provisioned users. |
| `allowedDomains` | `[]` (any) | Restrict sign-in to these email domains. |

Setup steps for Entra ID and Google are in `docs/DEPLOYING-A-NEW-BUSINESS.md`.

## `portal`

| Field | Default | Notes |
|---|---|---|
| `requestersSeeOrgTickets` | `false` | Default for new requesters: can they see their whole organization's tickets? It can be changed per user. |
| `allowRequesterClose` | `true` | Requesters can close their own tickets. |
| `requesterCloseStatus` | `closed` | State the close button moves to, when the workflow lets requesters make that transition. Otherwise the button uses the first transition into a closed or resolved state that the requester may perform (or doesn't appear). |
| `reopenOnReply` | `true` | A requester reply reopens a resolved ticket. |
| `reopenStatus` | `open` | State a reopened ticket goes to. |
| `suggestArticles` | `true` | Suggest knowledge base articles while typing a new ticket. |

## `features`

All booleans.

| Flag | Default | Turns on |
|---|---|---|
| `knowledgeBase` | `true` | Articles, categories, portal help center, suggestions. |
| `serviceCatalog` | `true` | Catalog items with forms and approvals. |
| `assets` | `false` | Asset inventory, CSV import/export, the "affected device" picker. |
| `problemManagement` | `false` | Problem tickets, known errors, "raise a problem". Needs a ticket type with `feature: problemManagement`. |
| `changeManagement` | `false` | Change tickets with risk, plans and CAB approval. Needs a ticket type with `feature: changeManagement`. |
| `agileBoards` | `false` | Kanban boards from `boards`. |
| `csat` | `false` | Satisfaction surveys (see `csat`). |
| `publicSignup` | `false` | Anyone can create a requester account from the portal. |

## `priorities`

```yaml
priorities:
  levels:            # most urgent first
    - { key: p1, name: P1 - Critical, color: "#dc2626" }
    - { key: p2, name: P2 - High }
  impact:            # who is affected
    - { key: company, name: Whole company }
    - { key: person,  name: One person }
  urgency:           # how badly
    - { key: blocked,  name: Can't work }
    - { key: degraded, name: Work is degraded }
  matrix:            # matrix[impact][urgency] = priority
    company: { blocked: p1, degraded: p2 }
    person:  { blocked: p2, degraded: p2 }
  default: p2
```

The matrix must cover every impact × urgency pair. When a ticket has an impact and urgency but no explicit priority, the matrix decides it.

## `sla`

| Field | Default | Notes |
|---|---|---|
| `enabled` | `true` | |
| `pauseStatuses` | `[]` | State keys that pause every SLA timer (for example "waiting on customer"). A state can also set `pausesSla: true`. |
| `warningPercent` | `80` | Warn when this share of the target has elapsed. |
| `policies[]` | `[]` | See below. A ticket gets the first policy matching its priority (and type, if listed). |
| `escalation.notifyOnWarning` | `true` | Notify the assignee and team leads. |
| `escalation.notifyOnBreach` | `true` | Notify the team's escalation target. |
| `escalation.reassignOnBreach` | `false` | Move the ticket to the team's `escalateTo.team` (or user). |
| `escalation.raisePriorityOnBreach` | `false` | Raise priority one level. |

### `sla.policies[]`

| Field | Notes |
|---|---|
| `key`, `name` | |
| `priorities` | Priority keys this policy covers. |
| `ticketTypes` | Optional; empty means all types. |
| `firstResponse` | Duration until the first public agent reply. |
| `resolution` | Duration until the ticket reaches a `resolved` or `closed` category state. |
| `calendar` | `business` (default: only business hours count) or `always` (24/7). |
| `pauseStatuses` | Overrides `sla.pauseStatuses` for this policy. |

At least one of `firstResponse` and `resolution` is required. Team leads can override a due date per ticket (`sla.override` permission), which is audited.

## `teams[]`

| Field | Default | Notes |
|---|---|---|
| `key`, `name`, `description` | | |
| `email` | none | Team address (informational). |
| `assignment` | `manual` | `round_robin` or `load_balanced` (fewest open tickets) auto-assigns new tickets in this team. |
| `members` / `leads` | `[]` | Emails. Applied when the team is first created; later only *new* members are added. Manage membership in **Admin → Teams**. |
| `escalateTo.team` / `escalateTo.user` | none | Target for SLA breach escalation. |

## `categories[]`

A tree: `{ key, name, children?: [...] }`. Categories are shared by all ticket types and shown in a dropdown with indentation.

## `ticketTypes[]`

| Field | Default | Notes |
|---|---|---|
| `key`, `name`, `description` | | |
| `prefix` | **required** | 2–6 uppercase letters: `INC` gives `INC0001042`. Must be unique. **Don't change it after go-live.** |
| `numberPadding` | `7` | Digits in the number. |
| `icon` | none | Shown on the portal's type cards. One of: `bug`, `help-circle`, `question`, `credit-card`, `file`, `folder`, `hard-drive`, `key`, `laptop`, `mail`, `monitor`, `package`, `printer`, `refund`, `refresh-ccw`, `shield`, `shopping-bag`, `phone`, `truck`, `user-minus`, `user-plus`, `wifi`, `wrench`. Unknown names show a generic icon. |
| `defaultPriority` | `priorities.default` | |
| `defaultTeam` | none | New tickets go to this team (unless an email mailbox or catalog item says otherwise). |
| `portalVisible` | `true` | Requesters can raise this type. |
| `feature` | none | `problemManagement` or `changeManagement`: the type belongs to that module and is hidden when the module is off. Editing these tickets needs `problem.manage` or `change.manage`. |
| `fields[]` | `[]` | Custom fields (below). |
| `workflow` | **required** | States and transitions (below). |

### `fields[]`

| Field | Default | Notes |
|---|---|---|
| `key`, `label` | | |
| `type` | **required** | `text`, `textarea`, `number`, `dropdown`, `multiselect`, `date`, `user`, `asset`, `checkbox` |
| `required` | `false` | Enforced on create (portal and agent) and by the API. |
| `options` | | Required for `dropdown` and `multiselect`: strings, or `{ value, label }`. |
| `helpText` | | Shown under the input. |
| `portal` | `true` | Show the field to requesters. Set `false` for agent-only fields. |
| `min`, `max` | | For `number`. |

An `asset` field links the chosen asset to the ticket. Requesters can only choose assets assigned to them.

### `workflow`

```yaml
workflow:
  initial: new
  states:
    - { key: new,         name: New,              category: new }
    - { key: in_progress, name: In Progress,      category: open }
    - { key: waiting,     name: Waiting on you,   category: pending, pausesSla: true, portalName: Waiting for your reply }
    - { key: resolved,    name: Resolved,         category: resolved }
    - { key: closed,      name: Closed,           category: closed }
  transitions:
    - { from: [new, waiting], to: in_progress, name: Start work, roles: [agent, team_lead, admin] }
    - { from: "*", to: resolved, name: Resolve, requireComment: true }
    - { from: resolved, to: closed, roles: [requester, agent] }
```

- **`category`** (`new`, `open`, `pending`, `resolved`, `closed`) is what reports, SLAs, CSAT and the portal understand. The state names are yours.
- **`from`** is a state, a list of states, or `"*"` (any).
- **`roles`**: role keys allowed to use the transition. `"*"` (the default) means anyone with `ticket.transition`. `requester` only applies to the ticket's own requester.
- **`requireComment`**: asks for a comment, which becomes a reply or note.
- Admins (`*` permission) can always use any defined transition. Nobody can jump between states that have no transition.
- **Change types:** the first `pending` state is where changes wait for the CAB, and its first transition into an `open` state counts as approval (see `itsm`).

## `email`

| Field | Default | Notes |
|---|---|---|
| `enabled` | `false` | Master switch for inbound and outbound mail. |
| `fromName` | `branding.name` | |
| `fromAddress` | `branding.supportEmail` | |
| `mailboxes[]` | `[]` | Inbound addresses (below). |
| `createUnknownSenders` | `true` | Create requester accounts for unknown senders. If false, their mail is ignored and logged. |
| `ignoreSenders` | `mailer-daemon@*`, `no-reply@*`, `noreply@*` | Glob patterns; auto-replies are also detected from headers. |

SMTP credentials go in `.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`). Without `SMTP_HOST`, emails are logged and not sent.

### `email.mailboxes[]`

| Field | Default | Notes |
|---|---|---|
| `address` | **required** | |
| `ticketType` | **required** | Type for new tickets from this mailbox. |
| `team` | type's `defaultTeam` | |
| `mode` | `imap` | `imap` polls the mailbox. `webhook` accepts POSTs from your mail provider at `/api/inbound/email?secret=INBOUND_EMAIL_SECRET`. |
| `imapEnvPrefix` | | Required for `imap`: reads `<PREFIX>_HOST`, `_PORT`, `_USER`, `_PASSWORD`, `_TLS` from `.env`. |
| `pollSeconds` | `60` | Minimum 15. |

Replies thread back to their ticket by `In-Reply-To`/`References` headers, falling back to the `[INC0001042]` tag in the subject. Quoted history is trimmed from replies.

## `csat`

| Field | Default | Notes |
|---|---|---|
| `sendOn` | `resolved` | Send when a ticket first reaches `resolved` or `closed`. |
| `delayMinutes` | `0` | Wait before sending; skipped if the ticket reopens meanwhile. |
| `scale` | `5` | `3` or `5`. |
| `question` | `How satisfied were you…?` | |

## `catalog[]` (bootstrap)

| Field | Default | Notes |
|---|---|---|
| `key`, `name`, `description`, `icon`, `group` | | `group` puts items under headings in the portal; `icon` takes the same names as ticket types. |
| `ticketType` | **required** | |
| `team`, `priority` | type defaults | |
| `requiresApproval` | `false` | |
| `approvers` | `[]` | Emails. Empty means anyone with `catalog.approve`. The first decision wins. |
| `fields[]` | `[]` | Same as ticket fields. |

Created once; edit afterwards in **Admin → Service catalog**.

## `organizations[]` (bootstrap)

`{ name, slug, domains: [example.com] }`. Requesters whose email domain matches are linked to the organization automatically.

## `boards[]`

| Field | Notes |
|---|---|
| `key`, `name` | |
| `ticketTypes` | Types shown on the board. |
| `team` | Optional: only this team's tickets. |
| `columns[]` | `{ name, states: [state keys], wipLimit? }`. Dropping a card in a column transitions it to the column's first state, following the workflow rules. WIP limits are shown, not enforced. |

## `itsm`

| Field | Default | Notes |
|---|---|---|
| `riskLevels` | low / medium / high | `{ key, name }` list for change risk. |
| `cabMembers` | `[]` | Emails of change advisory board voters. Empty means everyone with `change.approve`. |
| `cabQuorum` | `1` | Approvals needed (capped at the number of voters). Any rejection rejects. |
| `cabRequiredForRisk` | `[medium, high]` | Risk levels that need a CAB vote. Others are approved automatically. A risk level must be set before submitting. |

## `onboarding`

A `/welcome` page for new people, meant to be linked from onboarding emails:
**1. sign in → 2. secure the account with multi-factor sign-in → 3. welcome page**.
Admins can also email someone their personal link from **Administration →
Users → (person) → Send welcome email**.

| Field | Default | Notes |
|---|---|---|
| `enabled` | `false` | Turns the page on. |
| `provider` | none | `id` of an `auth.oidc` provider (e.g. `entra`). People sign in with it on step 1. Without it, they use email and password, and step 2 is the app's own 2FA setup. |
| `requireMfa` | `true` | Step 2 must be completed before the welcome page. |
| `mfaSetupUrl` | `https://aka.ms/mysecurityinfo` | Where people register an authenticator with the identity provider (Microsoft's "Security info" page). |
| `checkRegisteredMethods` | `false` | Entra only. Also ask Microsoft Graph whether the person has an authenticator registered. See below. |
| `welcome.title` | `You're all set` | Heading of the welcome step. |
| `welcome.message` | short default | Plain text; a blank line starts a new paragraph. |
| `welcome.links[]` | `[]` | `{ label, url, description? }` cards, e.g. `/portal/kb`. Put text containing commas **in quotes** (`description: "Email, VPN and printers"`), because a comma inside `{ … }` starts a new field. |
| `email.subject` | `Welcome! Set up your account` | Subject of the welcome email. |
| `email.message` | short default | Plain text; `{{firstName}}` and `{{name}}` are filled in. |
| `notifyAdmins` | `true` | Admins get an in-app notification when someone finishes. |

**How MFA is confirmed for SSO users.** The help desk can't register an
authenticator itself; that happens on Microsoft's page. It confirms MFA in one
of two ways:

- **Default:** when the person clicks *I've set it up, continue*, they sign in
  again, and the sign-in must report that MFA was used (the `amr` claim
  contains `mfa`). This works when your tenant asks for MFA at sign-in
  (Security defaults, or a Conditional Access policy requiring MFA for all users).
- **`checkRegisteredMethods: true`:** the help desk also asks Microsoft Graph
  (`/me/authentication/methods`) whether an authenticator is registered, so it
  works even when sign-in doesn't prompt for MFA. In Entra, add the delegated
  Microsoft Graph permission **UserAuthenticationMethod.Read** to the app
  registration and click **Grant admin consent**. Without consent, Microsoft
  sign-in fails for users.

Each user's page in **Administration → Users** shows when MFA was confirmed
and when they finished onboarding.


---

## Environment variables (`.env`)

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | **required** | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | `redis://localhost:6379` | Queues, rate limits. |
| `APP_BASE_URL` | `http://localhost:3000` | Public URL, used in emails, OIDC callbacks and secure-cookie decisions (it becomes Auth.js's `AUTH_URL` unless you set that yourself). |
| `AUTH_SECRET` | **required** | At least 32 characters (`openssl rand -base64 48`). Also encrypts stored secrets (2FA keys), so **back it up**: losing it disables every user's 2FA. |
| `AUTH_TRUST_HOST` | | Set `true` behind a reverse proxy. |
| `BUSINESS_CONFIG_PATH` | `./business.config.yaml` | |
| `BRANDING_DIR` | `./branding` | Logo and favicon files. |
| `LOG_LEVEL` | `info` | `trace` … `fatal`, or `silent`. |
| `STORAGE_DRIVER` | `local` | `local` or `s3`. |
| `STORAGE_LOCAL_PATH` | `./storage` | |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | | For S3, MinIO, R2 and others. |
| `UPLOAD_MAX_MB` | `25` | Per file. |
| `UPLOAD_ALLOWED_TYPES` | common documents and images | Comma-separated MIME types. |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` | | Outbound mail. |
| `INBOUND_EMAIL_SECRET` | | Required for webhook mailboxes. |
| `<PREFIX>_HOST/_PORT/_USER/_PASSWORD/_TLS` | | IMAP mailboxes, one set per `imapEnvPrefix`. |
| `<PREFIX>_CLIENT_ID/_CLIENT_SECRET/_ISSUER` | | OIDC providers, one set per `envPrefix`. |
| `WEBHOOK_ALLOW_PRIVATE` | `false` | Allow outgoing webhooks to private or internal addresses. |
| `RATE_LIMIT_PER_MINUTE` | `300` | Per user, API key or IP across the API. |
| `CLIENT_IP_HEADER` | unset | Read the visitor's IP from this header instead of `X-Forwarded-For`, e.g. `cf-connecting-ip` behind a Cloudflare Tunnel. Only set it when the app can be reached **only** through that proxy, because clients could otherwise forge it. |
| `TUNNEL_TOKEN` | unset | Cloudflare Tunnel token for `docker compose --profile cloudflared`. |
| `CADDYFILE` | `Caddyfile` | For `--profile caddy`: `Caddyfile` (automatic Let's Encrypt) or `Caddyfile.cloudflare` (behind the Cloudflare proxy, with an origin certificate). |
| `SLA_SWEEP_SECONDS` | `60` | How often the worker checks SLA timers. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | | Creates the first admin on `config:sync` (first start) if no admin exists. |
| `MULTI_TENANT` | `false` | Reserved for the future multi-tenant mode. |
