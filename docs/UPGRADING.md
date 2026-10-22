# Upgrading DeskForge

Upgrades never touch a business's configuration or data, because neither lives
in the image.

| What | Where it lives | Touched by an upgrade? |
| --- | --- | --- |
| Application code | Docker image (`deskforge:<tag>`) | Replaced |
| Database schema | PostgreSQL volume `pgdata` | Migrated forward automatically |
| Tickets, users, KB, … | PostgreSQL volume `pgdata` | Never |
| Attachments | `uploads` volume or your S3 bucket | Never |
| `business.config.yaml` | Deployment folder (mounted read-only) | Never |
| `branding/` | Deployment folder (mounted read-only) | Never |
| `.env` | Deployment folder | Never |

## Standard upgrade

Run these from the deployment folder (e.g. `deployments/acme`):

```bash
# 1. Back up first (database + uploads). See "Backups" below.
../../scripts/backup.sh

# 2. Get the new code (if you build from source)…
git -C "$(grep ^DESKFORGE_SRC .env | cut -d= -f2)" pull

#    …or point DESKFORGE_IMAGE in .env at the new tag if you use prebuilt images.

# 3. Rebuild / pull and restart. The web container applies database migrations
#    and re-syncs your config before it starts serving.
docker compose build        # or: docker compose pull
docker compose up -d

# 4. Check
docker compose ps
curl -fsS http://127.0.0.1:${APP_PORT:-3000}/api/health
docker compose logs --tail=50 app worker
```

On start, the `web` container runs in this order:

1. `scripts/check-config.ts`. Your existing config is validated against the
   **new** schema. If a release adds a required option or renames one, the
   container stops with an error that names the exact setting (for example
   `email.mailboxes[0].imapEnvPrefix: required when mode is imap`). Fix the
   setting in `business.config.yaml` and run `docker compose up -d` again. The
   old containers keep running until the new ones are healthy only if you use
   an external orchestrator. With plain compose, expect a short outage, so
   validate first (see below).
2. `prisma migrate deploy`. This applies only the new migrations. Migrations
   are additive, and a release that has to drop or rewrite data says so in its
   release notes.
3. `scripts/sync-config.ts`. This re-applies the config-owned parts (ticket
   types, fields, SLA policies, categories). Admin-UI changes to roles, teams,
   members and catalog items are kept (see DECISIONS.md D-006).

### Validate your config before upgrading

```bash
docker compose run --rm --no-deps app npx tsx scripts/check-config.ts /app/config/business.config.yaml
```

Run it with the **new** image, before restarting the stack.

## Upgrading many deployments

Every folder created by `scripts/new-business.sh` points `DESKFORGE_SRC` at
the same source checkout, so one `git pull` updates the code for all of them.
Then restart each one in turn:

```bash
for d in deployments/*/; do
  (cd "$d" && ../../scripts/backup.sh && docker compose up -d --build)
done
```

## Changing configuration (not code)

Edit `business.config.yaml`, then:

```bash
docker compose restart app worker
```

The restart validates the config and syncs it. Removing a ticket type, field,
SLA policy or category **deactivates** it instead of deleting it, so existing
tickets keep their data.

## Rolling back

1. Stop the stack: `docker compose down` (volumes are kept).
2. Restore the database backup taken before the upgrade:
   `../../scripts/restore.sh backups/<timestamp>`.
3. Set `DESKFORGE_IMAGE` (or check out the previous git tag) and run
   `docker compose up -d`.

Database migrations are not reversible automatically, which is why the upgrade
steps start with a backup.

## Backups

`scripts/backup.sh` writes a timestamped folder containing a `pg_dump` of the
database, a tarball of the uploads volume, and copies of `.env` and
`business.config.yaml`. `scripts/restore.sh` reverses it. Schedule the backup
with cron:

```cron
15 2 * * * cd /srv/deskforge/deployments/acme && ../../scripts/backup.sh --keep 14 >> backups/backup.log 2>&1
```
