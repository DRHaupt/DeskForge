# Branding assets

Files in this folder are served at `/branding/<file>` and referenced from
`business.config.yaml` (`branding.logo`, `branding.favicon`). Replace them with
your own logo and favicon (SVG, PNG, WebP or ICO). In Docker the folder is
mounted read-only at `/app/config/branding` — see `docker-compose.yml`.

Use a new file name for your own logo (for example `acme-logo.png`) rather
than overwriting `logo.svg`, so `git pull` never conflicts with your file.
Emails only show PNG, JPG or GIF logos (most email clients block SVG); with an
SVG logo, emails show the business name instead.
