/** Shared helpers for the end-to-end suite (seeded MSP example, see playwright.config.ts). */
import { expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_ENV } from "../../playwright.config";

export const PASSWORD = "DeskForge-Demo-2026!";
/** Seeded agent in the Service Desk team (no 2FA requirement for agents). */
export const AGENT = "mia.chen@northbeam-it.example";
export const LEAD = "dana.whitfield@northbeam-it.example";
/** Read-only role that sees every ticket; not in requireTwoFactorForRoles. */
export const AUDITOR = "auditor@northbeam-it.example";

export async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: E2E_ENV.DATABASE_URL });
  await c.connect();
  try {
    return (await c.query(text, values)).rows as T[];
  } finally {
    await c.end();
  }
}

/** A seeded requester from an organization (first by email). */
export async function aRequester(): Promise<string> {
  const [row] = await sql<{ email: string }>(
    `SELECT u.email FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE r.key = 'requester' AND u.organization_id IS NOT NULL AND u.is_active ORDER BY u.email LIMIT 1`,
  );
  return row!.email;
}

export async function login(page: Page, email: string, password = PASSWORD) {
  // The dev server compiles pages on first visit; retry if hydration reset the form mid-fill.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    try {
      await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
      return;
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
}

/** Poll until `fn` returns a truthy value (for work done by the background worker). */
export async function eventually<T>(fn: () => Promise<T | null | undefined | false>, { timeout = 45_000, interval = 1000, what = "condition" } = {}): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Create a ticket through the portal as the signed-in requester; returns its number. */
export async function portalTicket(page: Page, title: string, details = "Details from the e2e suite.") {
  await page.goto("/portal/new");
  await page.getByLabel("Subject").fill(title);
  await page.getByRole("textbox", { name: "Details" }).fill(details);
  // Fill any required dropdowns with their first option.
  for (const select of await page.locator("select[required], select[aria-required=true]").all()) {
    const options = await select.locator("option").allTextContents();
    if (options.length > 1) await select.selectOption({ index: 1 });
  }
  await page.getByRole("button", { name: /submit/i }).click();
  await expect(page).toHaveURL(/\/portal\/tickets\/[A-Z]+\d+/);
  return page.url().split("/").pop()!;
}
