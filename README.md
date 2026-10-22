# DeskForge

A self-hostable, configuration-driven IT service management and help desk
platform: ticketing with configurable workflows, SLAs, email-to-ticket, a branded
customer portal, knowledge base, service catalog, automations, assets and
reporting.

DeskForge is a **template**. Each business gets its own deployment made from two
files, with no code changes:

- **`.env`** holds secrets and infrastructure (database, SMTP, SSO client secrets).
- **`business.config.yaml`** holds everything else: name, logo, colors, business
  hours, ticket types, custom fields, workflows, priorities, SLAs, teams,
  routing and feature flags.

> Screenshots: _placeholder — add `docs/images/agent-console.png`, `docs/images/portal.png`, `docs/images/admin-roles.png`._

## Quick start (Docker)

```bash
git clone <this repo> deskforge && cd deskforge
cp .env.example .env                            # set AUTH_SECRET, POSTGRES_PASSWORD, SEED_ADMIN_*
cp examples/internal-it.yaml business.config.yaml
docker compose up -d
open http://localhost:3000
```

Set `SEED_DEMO_DATA=true` in `.env` before the first start to load a realistic
demo (organizations, agents, requesters, tickets in every state, KB articles).
Demo accounts use the password `DeskForge-Demo-2026!` unless you set
`SEED_DEMO_PASSWORD`.

To spin up a **new business** in its own folder, with generated secrets:

```bash
scripts/new-business.sh acme msp-it-support     # → deployments/acme/
cd deployments/acme && docker compose up -d
```

See [docs/DEPLOYING-A-NEW-BUSINESS.md](docs/DEPLOYING-A-NEW-BUSINESS.md) for DNS,
reverse proxy (Caddy / Nginx), email and SSO (Microsoft Entra ID, Google) setup.

## Example configurations

| File | Scenario |
| --- | --- |
| [`examples/msp-it-support.yaml`](examples/msp-it-support.yaml) | Managed IT provider serving several client companies. ITIL incidents, requests, problems and changes with CAB approval. 24/7 P1 SLA, Entra ID sign-in. |
| [`examples/internal-it.yaml`](examples/internal-it.yaml) | Volunteer IT desk for a club or small org. Google sign-in, catalog with approvals, assets, and a Kanban board for internal projects. |
| [`examples/ecommerce-support.yaml`](examples/ecommerce-support.yaml) | Customer care for an online store. Order and return forms, public sign-up, CSAT surveys, no ITIL change management. |

Every option is documented in [docs/CONFIG-REFERENCE.md](docs/CONFIG-REFERENCE.md).
Validate a config without starting anything:

```bash
npm run config:check -- path/to/business.config.yaml
```

## Architecture

```mermaid
flowchart LR
  subgraph Clients
    A[Agents & admins<br/>/agent /admin]
    R[Requesters<br/>/portal]
    X[Integrations<br/>REST /api/v1 + API keys]
    M[Mail provider<br/>IMAP / inbound webhook]
  end

  subgraph "DeskForge (one Docker image)"
    W["web: Next.js App Router<br/>pages, server actions, route handlers"]
    K["worker: BullMQ consumers<br/>SLA sweep, email, automations, webhooks"]
    C["src/core<br/>domain logic: workflow, SLA,<br/>assignment, automation, RBAC"]
    S["src/server<br/>adapters: Prisma, Auth.js, storage,<br/>search, mail, queues, audit"]
  end

  P[(PostgreSQL<br/>data + full-text search)]
  Q[(Redis<br/>queues, rate limits)]
  F[(Files<br/>local volume or S3)]
  Y[/business.config.yaml/]

  A & R & X --> W
  M --> W & K
  W --> C & S
  K --> C & S
  S --> P & Q & F
  Y -. validated at startup .-> W & K
  K -- SMTP / signed webhooks --> O[(Outside world)]
```

- **`src/core`** contains pure TypeScript domain logic (config schema, workflow
  engine, SLA calculator, assignment, automation rules, permissions). It never
  imports Next.js and is unit-tested in isolation.
- **`src/server`** contains infrastructure: database, auth, the API wrapper
  (Zod validation, permission check, CSRF, rate limit, audit), queues, mail and
  storage.
- **`src/app`** contains Next.js routes. Route handlers stay thin and call
  services.
- **`src/worker`** is the BullMQ worker process, run from the same image.

## Development

Requirements: Node 22+, PostgreSQL 16, Redis 7 (or `docker compose up -d postgres redis`).

```bash
npm install
cp .env.example .env              # set DATABASE_URL, REDIS_URL, AUTH_SECRET
cp examples/msp-it-support.yaml business.config.yaml
npx prisma migrate deploy && npm run db:seed
npm run dev                       # web on :3000
npm run worker:dev                # background worker
```

| Command | What it does |
| --- | --- |
| `npm test` | Unit + integration tests (Vitest; integration tests use `<db>_test`) |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run typecheck` | TypeScript |
| `npm run config:check` | Validate a business config |
| `npm run config:sync` | Push config changes (types, SLAs, categories) into the database |
| `npm run db:migrate` | Create a migration after editing `prisma/schema.prisma` |

## Project layout

```
examples/            three ready-made business configs
branding/            default logo/favicon (each deployment mounts its own)
deploy/              Caddyfile and Nginx example
docs/                deployment, config reference, upgrading
prisma/              schema, migrations, seed
scripts/             new-business.sh, backup/restore, entrypoint, config tools
src/app/             Next.js routes: /agent, /admin, /portal, /api/v1, …
src/core/            domain logic (no framework imports)
src/server/          infrastructure adapters + services
src/worker/          BullMQ worker
src/components/      UI (Tailwind + shadcn-style components)
tests/               unit, integration (Vitest) and e2e (Playwright)
```

## Documentation

- [Deploying a new business](docs/DEPLOYING-A-NEW-BUSINESS.md)
- [Configuration reference](docs/CONFIG-REFERENCE.md)
- [Upgrading](docs/UPGRADING.md)
- [Design decisions](DECISIONS.md)

## License

MIT
