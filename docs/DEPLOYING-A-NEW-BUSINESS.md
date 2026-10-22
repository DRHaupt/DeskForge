# Deploying DeskForge for a new business

This guide takes you from nothing to a running help desk on your own domain, with
HTTPS, email in and out, and single sign-on. Allow about an hour, most of it
waiting for DNS and setting up the mail and SSO providers.

Each business gets **its own deployment folder** with its own `.env`,
`business.config.yaml`, logo, database and file storage. One server can host
several businesses side by side (see [several businesses on one server](#several-businesses-on-one-server)).

## What you need

- A Linux server with Docker Engine 24+ and the Compose plugin. 2 vCPU and 4 GB RAM is plenty for a few hundred agents.
- A domain or subdomain you control, for example `help.example.com`.
- An SMTP service for outgoing mail (Microsoft 365, Google Workspace, Postmark, Amazon SES, Mailgun…).
- Optional: a Microsoft Entra ID tenant or Google Workspace for single sign-on.
- A clone of this repository on the server (the deployment builds the image from it).

```sh
git clone <your fork of DeskForge> /opt/deskforge
cd /opt/deskforge
```

## 1. Create the deployment folder

Pick the example closest to the business: `msp-it-support`, `internal-it` or `ecommerce-support`.

```sh
scripts/new-business.sh acme internal-it /srv/helpdesk/acme
```

This creates:

```
/srv/helpdesk/acme/
  .env                  # secrets, generated for you (chmod 600)
  business.config.yaml  # copy of the example: edit this
  branding/             # logo.svg, favicon.svg: replace with yours
  docker-compose.yml
  deploy/Caddyfile
  README.md
```

`AUTH_SECRET`, the Postgres password and a first admin password are generated.
**Keep a copy of `.env` somewhere safe.** `AUTH_SECRET` also encrypts users'
2FA keys, so if you lose it every user has to set up 2FA again.

## 2. Describe the business

Edit `business.config.yaml`: name, colors, time zone and business hours,
holidays, teams and their members, ticket types, workflows, SLAs, email
mailboxes and catalog. Every option is documented in
[`CONFIG-REFERENCE.md`](CONFIG-REFERENCE.md).

Put the logo in `branding/` and point `branding.logo` at it (`logo: logo.svg`).

Check the file before starting:

```sh
cd /opt/deskforge && npm ci && npm run config:check -- /srv/helpdesk/acme/business.config.yaml
```

(The containers validate it on start too and refuse to boot with a clear message.)

## 3. DNS

Create an `A` (and `AAAA` if you have IPv6) record for the help desk host,
pointing at the server:

```
help.acme.example.   300  IN  A     203.0.113.10
```

For email you send from your own domain, add the records your SMTP provider
gives you (see [Email](#5-email)):

| Record | Purpose |
|---|---|
| `TXT @  "v=spf1 include:<provider> -all"` | SPF: lets the provider send as your domain |
| `TXT <selector>._domainkey` (or CNAME) | DKIM signature key |
| `TXT _dmarc  "v=DMARC1; p=quarantine; rua=mailto:dmarc@acme.example"` | DMARC policy |

Without SPF, DKIM and DMARC, replies to requesters will often land in spam.

## 4. Start it

In `.env`, set at least:

```ini
APP_BASE_URL=https://help.acme.example
AUTH_TRUST_HOST=true
DOMAIN=help.acme.example            # only for the built-in Caddy proxy
SEED_DEMO_DATA=false                # true = load sample tickets, users and articles
```

Then start the stack:

```sh
cd /srv/helpdesk/acme
docker compose up -d --build                 # with your own reverse proxy (see below)
# or
docker compose --profile caddy up -d --build # with built-in automatic HTTPS
docker compose logs -f app
```

On start the app validates the config, applies database migrations, syncs the
config into the database, and creates the admin account from
`SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`. Sign in with that account at
`https://help.acme.example/login`.

If the config lists `admin` under `auth.requireTwoFactorForRoles`, you'll be
asked to set up an authenticator app straight away. After the first sign-in,
**change the admin password** (Account → Password) and remove
`SEED_ADMIN_PASSWORD` from `.env`.

### HTTPS option A: built-in Caddy (simplest)

`docker compose --profile caddy up -d` runs Caddy on ports 80 and 443. It gets
and renews a Let's Encrypt certificate for `DOMAIN` automatically. Ports 80
and 443 must be reachable from the internet, and DNS must already point at the
server.

### HTTPS option B: Nginx on the host

Keep `APP_BIND=127.0.0.1` so the app is only reachable through Nginx, then use
`deploy/nginx.conf.example`:

```sh
sudo cp /opt/deskforge/deploy/nginx.conf.example /etc/nginx/sites-available/acme-helpdesk
sudo sed -i 's/help.example.com/help.acme.example/g' /etc/nginx/sites-available/acme-helpdesk
sudo ln -s /etc/nginx/sites-available/acme-helpdesk /etc/nginx/sites-enabled/
sudo certbot --nginx -d help.acme.example
sudo nginx -t && sudo systemctl reload nginx
```

The example config forwards `X-Forwarded-For`/`-Proto` (needed for rate limits,
audit logs and secure cookies) and sets `client_max_body_size` above
`UPLOAD_MAX_MB`.

### HTTPS option C: an existing proxy or load balancer

Forward to `APP_BIND:APP_PORT` (default `127.0.0.1:3000`). Pass the `Host` and
`X-Forwarded-*` headers, allow request bodies at least as large as
`UPLOAD_MAX_MB`, and set `AUTH_TRUST_HOST=true`.

### HTTPS option D: behind Cloudflare

If the domain's DNS is on Cloudflare with the proxy on (orange cloud), use an
origin certificate instead of Let's Encrypt, and tell Caddy to trust
Cloudflare's addresses so the app sees real visitor IPs.

**In the Cloudflare dashboard** (for your zone):

1. **DNS**: an `A` record `help` pointing at the server's IP, **Proxied** (orange cloud).
2. **SSL/TLS → Overview**: encryption mode **Full (strict)**. *Flexible* causes redirect loops and leaves the hop to your server unencrypted.
3. **SSL/TLS → Origin Server → Create Certificate**: keep the RSA key, list `help.acme.example`, and pick a validity (up to 15 years). Copy the certificate and private key.
4. **SSL/TLS → Edge Certificates**: turn on *Always Use HTTPS*, and set minimum TLS version to 1.2.
5. Make sure these are **off** for the help desk host: **Rocket Loader** and **Email Address Obfuscation** (Speed / Scrape Shield, or a Configuration Rule for the hostname). Both rewrite pages and break the app's scripts. Don't add "Cache Everything" rules: pages are personal and must not be cached.

**On the server**, in the deployment folder:

```sh
nano deploy/certs/origin.pem      # paste the origin certificate
nano deploy/certs/origin.key      # paste the private key
chmod 600 deploy/certs/*
```

In `.env`:

```ini
APP_BASE_URL=https://help.acme.example
AUTH_TRUST_HOST=true
DOMAIN=help.acme.example
CADDYFILE=Caddyfile.cloudflare
```

Start it, then refresh Cloudflare's IP list (and keep it fresh weekly):

```sh
docker compose --profile caddy up -d --build
scripts/update-cloudflare-ips.sh
( crontab -l 2>/dev/null; echo "0 4 * * 1  cd $PWD && scripts/update-cloudflare-ips.sh >/dev/null" ) | crontab -
```

**Recommended: lock the server to Cloudflare.** Docker-published ports
**bypass UFW**, so firewall rules won't stop people reaching ports 80 and 443
directly. Use Cloudflare's *Authenticated Origin Pulls* instead: Cloudflare
then presents a client certificate, and Caddy rejects anyone else.

1. **SSL/TLS → Origin Server → Authenticated Origin Pulls**: on.
2. Download Cloudflare's origin-pull CA certificate (linked from that setting's documentation) to `deploy/certs/cloudflare-origin-pull-ca.pem`.
3. In `deploy/Caddyfile.cloudflare`, uncomment the `client_auth { … }` block, then run `docker compose --profile caddy restart caddy`.

**Things that behave differently behind Cloudflare:**

- **Upload size**: Cloudflare limits request bodies to 100 MB on Free and Pro plans. Keep `UPLOAD_MAX_MB` below that.
- **Bot protection**: *Bot Fight Mode* can challenge your mail provider's posts to `/api/inbound/email` and scripts calling `/api/v1`. If inbound email or API calls start getting 403s or challenge pages, turn it off. On paid plans, add a WAF skip rule for those paths instead.
- **Inbound email webhooks** can come from your provider straight through Cloudflare. Nothing else is needed.

### HTTPS option E: Cloudflare Tunnel (Zero Trust)

The server opens **no inbound ports**. A `cloudflared` container connects out
to Cloudflare and carries the traffic, and Cloudflare provides the HTTPS
certificate. You don't need Caddy, Nginx or an origin certificate.

**In the Zero Trust dashboard** (one.dash.cloudflare.com):

1. **Networks → Tunnels → Create a tunnel** → *Cloudflared* → name it (e.g. `helpdesk-acme`).
2. On the install screen, copy the **token**: the long string after `--token` in any of the commands. You don't need to run those commands.
3. **Public hostname**: subdomain `help`, your domain, service **HTTP** `app:3000`.
   (`app` is the Compose service name. The tunnel container reaches it over the stack's internal network.)

**On the server**, in `.env`:

```ini
APP_BASE_URL=https://help.acme.example
AUTH_TRUST_HOST=true
TUNNEL_TOKEN=<the token>
CLIENT_IP_HEADER=cf-connecting-ip
APP_BIND=127.0.0.1
```

Then start it:

```sh
docker compose --profile cloudflared up -d --build
docker compose logs cloudflared     # look for "Registered tunnel connection"
```

The tunnel status in the dashboard turns *Healthy* and the site is live at
`https://help.acme.example`.

Why these settings matter:

- **`CLIENT_IP_HEADER=cf-connecting-ip`**: through a tunnel, every request comes from the `cloudflared` container. This setting makes rate limits and the audit log use the real visitor's IP. It's only safe because nothing but the tunnel can reach the app: keep `APP_BIND=127.0.0.1` and don't open ports 80 or 443.
- **`APP_BASE_URL`**: sign-in uses it for callback URLs and secure cookies. The tunnel talks plain HTTP to the app, so the app doesn't guess the URL from the request.
- **Firewall**: you can enable UFW for SSH only (`sudo ufw allow OpenSSH && sudo ufw enable`). The tunnel needs outbound access only.

**Zero Trust Access policies.** You don't need Cloudflare Access: DeskForge has
its own sign-in and permissions. If you do add an Access application in front
of the help desk, scope it carefully. Otherwise you will block people and
services that can't pass an Access login:

| Who | Paths | Access policy |
|---|---|---|
| Agents and admins | `/agent*`, `/admin*` | Optional: require your identity provider (an extra layer for staff). |
| Requesters and customers | `/`, `/portal*`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/account*`, `/csat*`, `/api/auth*`, `/_next*`, `/branding*` | Leave open (or **Bypass**). External customers can't pass a staff-only Access login. For an internal-only help desk where everyone is in your IdP, you can protect these too. |
| Mail provider webhook | `/api/inbound/email` | **Bypass**. It's protected by `INBOUND_EMAIL_SECRET`. |
| Integrations | `/api/v1*` | **Bypass**, or require an Access *service token*. Calls already need a DeskForge API key. |
| Uptime checks | `/api/health` | **Bypass** (or keep it private). |

Path-scoped Access applications are created under **Access → Applications →
Add → Self-hosted**, with one application per path pattern. Clicking links in
emails (ticket replies, CSAT ratings, password resets) only works for paths
the recipient can reach.

**Other Cloudflare settings** (same as option D): turn off **Rocket Loader**
and **Email Address Obfuscation** for the host, don't use "Cache Everything",
keep `UPLOAD_MAX_MB` under Cloudflare's 100 MB request limit, and turn off
**Bot Fight Mode** if inbound-email webhooks or API calls get challenged.

**Running `cloudflared` on the host instead** (for example if it already
serves other sites): install it as a system service with the same token, set
the public hostname's service to `http://localhost:3000`, and leave out the
`cloudflared` profile. Everything else is the same.

## 5. Email

### Outgoing (SMTP)

```ini
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_USER=<server token>
SMTP_PASSWORD=<server token>
SMTP_SECURE=false        # true only for port 465
```

| Provider | Host / port | Notes |
|---|---|---|
| Microsoft 365 | `smtp.office365.com:587` | Turn on "Authenticated SMTP" for the mailbox. Send-as must match `email.fromAddress`. |
| Google Workspace | `smtp-relay.gmail.com:587` | Configure the SMTP relay service in the Admin console (allow by IP or authenticate). |
| Postmark, SES, Mailgun… | per provider | Verify the sending domain and add their SPF and DKIM records. |

Then set `email.enabled: true` and `email.fromAddress` in the config. Without
`SMTP_HOST`, emails are recorded in **Admin → Email log** but not sent, which is
handy while testing.

### Incoming

Each address listed under `email.mailboxes` becomes a way to open tickets, and
replies to DeskForge emails thread back onto their ticket. There are two modes:

**IMAP polling** (`mode: imap`): DeskForge logs in to the mailbox every
`pollSeconds`, imports new mail and marks it as read.

```ini
IMAP_HELP_HOST=imap.example.com
IMAP_HELP_PORT=993
IMAP_HELP_USER=help@acme.example
IMAP_HELP_PASSWORD=<app password>
IMAP_HELP_TLS=true
```

- Google Workspace: enable IMAP for the mailbox and use an app password (the account needs 2-Step Verification).
- Microsoft 365 no longer accepts passwords over IMAP. Use the webhook mode
  instead: forward the mailbox to an inbound-parse service (below), or run a
  small relay that fetches mail with OAuth and posts it to the webhook.

**Webhook** (`mode: webhook`): your mail provider posts each message to

```
https://help.acme.example/api/inbound/email?secret=<INBOUND_EMAIL_SECRET>
```

Set a long random `INBOUND_EMAIL_SECRET` in `.env`. The endpoint accepts raw
MIME (`message/rfc822`), Mailgun and SendGrid "raw MIME" form posts, and
Postmark-style JSON. Point Mailgun Routes, SendGrid Inbound Parse, Postmark
inbound or a Cloudflare Email Worker at it, and forward your support address to
the provider's inbound address.

Auto-replies, bounces and addresses in `email.ignoreSenders` are ignored.
Unknown senders become requesters when `createUnknownSenders` is true.

## 6. Single sign-on

The callback URL for a provider is `https://<your host>/api/auth/callback/<id>`,
where `<id>` is the provider's `id` in `auth.oidc`.

### Microsoft Entra ID

1. Entra admin center → **App registrations** → **New registration**.
   - Name: e.g. "Acme Help Desk".
   - Supported account types: *Accounts in this organizational directory only*.
   - Redirect URI: **Web**, `https://help.acme.example/api/auth/callback/entra`.
2. Copy the **Application (client) ID** and **Directory (tenant) ID**.
3. **Certificates & secrets** → New client secret → copy the **value**. Note its expiry date: sign-in breaks when it expires.
4. **API permissions**: the default `User.Read` is enough (DeskForge asks for `openid profile email`).
5. In the config:

   ```yaml
   auth:
     oidc:
       - id: entra
         type: microsoft-entra-id
         label: Sign in with Microsoft
         envPrefix: OIDC_ENTRA
         autoProvision: true
         defaultRole: requester
         allowedDomains: [acme.example]
   ```

6. In `.env`:

   ```ini
   OIDC_ENTRA_CLIENT_ID=<application id>
   OIDC_ENTRA_CLIENT_SECRET=<secret value>
   OIDC_ENTRA_ISSUER=https://login.microsoftonline.com/<tenant id>/v2.0
   ```

### Google

1. Google Cloud console → pick or create a project → **APIs & Services → OAuth consent screen**.
   Choose *Internal* (Workspace only) or *External*, and add the scopes `openid`, `email` and `profile`.
2. **Credentials → Create credentials → OAuth client ID** → *Web application*.
   - Authorized redirect URI: `https://help.acme.example/api/auth/callback/google`.
3. Copy the client ID and secret into `.env`:

   ```ini
   OIDC_GOOGLE_CLIENT_ID=<client id>
   OIDC_GOOGLE_CLIENT_SECRET=<client secret>
   ```

4. Add the provider under `auth.oidc` with `type: google` and `envPrefix: OIDC_GOOGLE`.
   Use `allowedDomains` to stop personal Gmail accounts signing in.

### How SSO users are matched

The first sign-in links the identity to an existing user with the same
(verified) email. Otherwise, with `autoProvision: true`, it creates a user with
`defaultRole`. Promote agents in **Admin → Users**. Roles are never taken from
the identity provider. You can set `auth.local.enabled: false` to allow SSO only, but keep
one admin who can still sign in (for example through SSO).

## 7. File storage

Attachments go to the `uploads` Docker volume by default. To use S3-compatible
storage instead (AWS S3, Cloudflare R2, Backblaze B2, MinIO):

```ini
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # empty for AWS
S3_REGION=auto
S3_BUCKET=acme-helpdesk
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
```

Keep the bucket private: DeskForge checks permissions and streams files itself.
`docker compose --profile minio up -d` runs a local MinIO if you want S3
behaviour on one box.

## 8. Backups

From the deployment folder:

```sh
/opt/deskforge/scripts/backup.sh --keep 14
```

This writes `backups/<timestamp>/` with a `pg_dump` of the database, the
uploads volume (local storage), and copies of `business.config.yaml` and
`.env`. **The backup contains secrets**: store it encrypted and off the server.

Run it nightly with cron:

```cron
15 2 * * *  cd /srv/helpdesk/acme && /opt/deskforge/scripts/backup.sh --keep 14 >> backups/backup.log 2>&1
```

Then copy `backups/` somewhere else (restic, rclone, your backup system). With
S3 storage, also enable versioning or replication on the bucket.

To restore (this replaces the current database and uploads):

```sh
docker compose stop app worker
/opt/deskforge/scripts/restore.sh backups/2026-10-22T02-15-00 --yes
docker compose up -d
```

Test a restore on a spare machine now and then.

## 9. Several businesses on one server

Run `new-business.sh` once per business. Each folder is its own Compose project
(`COMPOSE_PROJECT_NAME`) with its own containers, volumes and database. Give
each a different `APP_PORT` in its `.env` (3000, 3001, …), keep
`APP_BIND=127.0.0.1`, and add one Nginx server block per domain, each
proxying to its port. Don't use the per-business Caddy profile in this setup,
because only one process can listen on ports 80 and 443.

## 10. Go-live checklist

- [ ] `APP_BASE_URL` is the real HTTPS URL, and `AUTH_TRUST_HOST=true` behind a proxy.
- [ ] Admin password changed; `SEED_ADMIN_PASSWORD` removed from `.env`; admin 2FA set up.
- [ ] If demo data was loaded: demo users deactivated (**Admin → Users**) or the database recreated without `SEED_DEMO_DATA`.
- [ ] Teams, leads and escalation targets match real people.
- [ ] Business hours, holidays and time zone are correct (SLA due dates depend on them).
- [ ] A test email goes out, arrives (not in spam), and a reply threads back onto the ticket.
- [ ] SSO tested with a normal user, and with an account outside `allowedDomains` (which should be refused).
- [ ] The nightly backup runs and has been restored once on a test machine.
- [ ] Firewall: only 80/443 (and SSH) open; Postgres and Redis are not published.

## Troubleshooting

| Symptom | Check |
|---|---|
| App container restarts | `docker compose logs app`: config errors print the exact YAML path. |
| "Invalid environment variables" | Missing `AUTH_SECRET` (32+ chars) or `POSTGRES_PASSWORD`. |
| Sign-in loops back to the login page | `APP_BASE_URL` doesn't match the URL in the browser, or the proxy isn't forwarding `X-Forwarded-Proto`. |
| SSO "redirect URI mismatch" | The URI registered with the provider must be exactly `https://<host>/api/auth/callback/<id>`. |
| Emails not sent | **Admin → Email log** shows each attempt and its error; check that the worker is running (`docker compose ps`). |
| Replies create new tickets | The provider must keep the `In-Reply-To`/`References` headers, or keep `[INC0000123]` in the subject. |
| SLA timers never warn or breach | The worker isn't running, or business hours/holidays exclude the current time. |
| Uploads fail | `client_max_body_size` in Nginx is below `UPLOAD_MAX_MB`, or the file type isn't allowed. |
| Cloudflare error 525/526 | SSL mode isn't *Full (strict)*, or `deploy/certs/origin.pem`/`.key` are missing or don't match. |
| Cloudflare redirect loop | SSL mode is *Flexible*; switch to *Full (strict)*. |
| Everyone hits sign-in rate limits behind Cloudflare | `CADDYFILE` isn't `Caddyfile.cloudflare`, or `deploy/cloudflare-ips.caddy` is out of date; run `scripts/update-cloudflare-ips.sh`. |
| Pages half-load or buttons don't work behind Cloudflare | Rocket Loader or Email Address Obfuscation is on for the host. |
| Tunnel shows *Down* / error 1033 | `docker compose logs cloudflared`: check `TUNNEL_TOKEN`, and that the server allows outbound connections on port 7844 (or 443). |
| Tunnel error 502 | The public hostname's service must be `http://app:3000` (container) or `http://localhost:3000` (host-installed cloudflared), and the app must be healthy. |
| Customers see a Cloudflare Access login | An Access application covers the portal paths; scope it to `/agent` and `/admin` (see the table in option E). |

Upgrading to a new DeskForge version is covered in [`UPGRADING.md`](UPGRADING.md).
