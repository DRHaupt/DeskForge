import { expect, test } from "@playwright/test";
import { totpCode } from "../../src/core/auth/totp";
import { AGENT, LEAD, PASSWORD, aRequester, login } from "./helpers";

test("rejects a wrong password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(AGENT);
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("don't match");
  await expect(page).toHaveURL(/\/login/);
});

test("requesters land in the portal and agents in the console", async ({ browser }) => {
  const requester = await (await browser.newContext()).newPage();
  await login(requester, await aRequester());
  await requester.goto("/");
  await expect(requester).toHaveURL(/\/portal/);
  await expect(requester.getByRole("link", { name: "My tickets" })).toBeVisible();

  const agent = await (await browser.newContext()).newPage();
  await login(agent, AGENT);
  await agent.goto("/agent");
  await expect(agent.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening)/);
  // Agents can't reach admin pages they lack permission for.
  const res = await agent.goto("/admin/roles");
  expect(res?.status()).toBe(403);
});

test("team leads must set up two-factor sign-in, then need a code", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await login(page, LEAD);
  await page.goto("/agent/tickets");
  await expect(page).toHaveURL(/\/account\/two-factor\?required=1/);
  await page.getByRole("button", { name: "Set up two-factor sign-in" }).click();
  const secret = (await page.locator("code").first().textContent())!.replace(/\s+/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  await page.getByLabel(/Enter the 6-digit code/).fill(totpCode(secret));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page).not.toHaveURL(/two-factor/);
  await page.goto("/agent/tickets");
  await expect(page).toHaveURL(/\/agent\/tickets/);

  // A fresh sign-in now asks for a code.
  const again = await (await browser.newContext()).newPage();
  await again.goto("/login");
  await again.getByLabel("Email").fill(LEAD);
  await again.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await again.getByRole("button", { name: /sign in/i }).click();
  await expect(again.getByLabel("Authentication code")).toBeVisible();
  await again.getByLabel("Authentication code").fill(totpCode(secret));
  await again.getByRole("button", { name: /sign in/i }).click();
  await expect(again).not.toHaveURL(/\/login/);
});
