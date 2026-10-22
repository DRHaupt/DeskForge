# Branding assets

Files in this folder are served at `/branding/<file>` and referenced from
`business.config.yaml` (`branding.logo`, `branding.favicon`). Replace them with
your own logo and favicon (SVG, PNG, WebP or ICO). In Docker the folder is
mounted read-only at `/app/branding` — see `docker-compose.yml`.
