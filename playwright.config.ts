import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;

/** Environment for the e2e app + worker. Override any of these from the shell. */
export const E2E_ENV = {
  NODE_ENV: "development",
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgresql://deskforge:deskforge@localhost:5432/deskforge_e2e",
  REDIS_URL: process.env.E2E_REDIS_URL ?? "redis://localhost:6379/1",
  APP_BASE_URL: BASE,
  AUTH_SECRET: process.env.E2E_AUTH_SECRET ?? "e2e-only-secret-not-for-production-0123456789",
  AUTH_TRUST_HOST: "true",
  BUSINESS_CONFIG_PATH: "./examples/msp-it-support.yaml",
  INBOUND_EMAIL_SECRET: "e2e-inbound-secret",
  SLA_SWEEP_SECONDS: "3",
  NEXT_DIST_DIR: ".next-e2e",
  LOG_LEVEL: "warn",
};

const chromium = process.env.PW_CHROMIUM ?? (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

export default defineConfig({
  testDir: "tests/e2e",
  // Tests share one seeded database and a worker; run them in order.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: chromium ? { executablePath: chromium } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "sh scripts/e2e-server.sh",
    url: `${BASE}/api/health`,
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "pipe",
    env: E2E_ENV,
  },
});
