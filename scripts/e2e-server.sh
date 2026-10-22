#!/bin/sh
# Starts everything the Playwright suite needs: a fresh seeded database,
# the background worker and a dev server on port 3100 (its own build folder,
# so it can run beside your normal dev server). Used by playwright.config.ts.
set -e
npx tsx scripts/e2e-reset.ts
npx tsx prisma/seed.ts
# Log inside the e2e build folder: Playwright empties test-results/ on start,
# and the dev server would rebuild on every write to a watched file.
mkdir -p .next-e2e
npx tsx src/worker/index.ts > .next-e2e/worker.log 2>&1 &
exec npx next dev -p 3100
