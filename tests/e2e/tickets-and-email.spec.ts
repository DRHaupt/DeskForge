import { expect, test } from "@playwright/test";
import { AGENT, aRequester, eventually, login, portalTicket, sql } from "./helpers";

test.describe.configure({ mode: "serial" });

let number = "";
let requesterEmail = "";

test("a requester raises a ticket in the portal", async ({ page }) => {
  requesterEmail = await aRequester();
  await login(page, requesterEmail);
  number = await portalTicket(page, "Shared calendar not syncing on my laptop", "Since this morning my team calendar shows yesterday's meetings.");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Shared calendar not syncing");
  await page.goto("/portal/tickets");
  await expect(page.getByText(number)).toBeVisible();
});

test("an agent replies and the requester sees it", async ({ browser }) => {
  const agent = await (await browser.newContext()).newPage();
  await login(agent, AGENT);
  await agent.goto(`/agent/tickets/${number}`);
  await agent.getByRole("textbox", { name: "Reply to requester" }).fill("Thanks — please restart Outlook and tell us if it syncs.");
  await agent.getByRole("button", { name: "Send reply" }).click();
  await expect(agent.getByText("please restart Outlook")).toBeVisible();

  const requester = await (await browser.newContext()).newPage();
  await login(requester, requesterEmail);
  await requester.goto(`/portal/tickets/${number}`);
  await expect(requester.getByText("please restart Outlook")).toBeVisible();

  // The reply was emailed to the requester (logged transport in e2e).
  const sent = await eventually(
    async () => (await sql<{ message_id: string }>(`SELECT message_id FROM outbound_emails WHERE to_address = $1 AND subject LIKE $2 ORDER BY created_at DESC`, [requesterEmail, `%${number}%`]))[0],
    { what: "reply email" },
  );
  expect(sent.message_id).toContain("@");
});

test("an emailed reply threads back onto the same ticket", async ({ page, request }) => {
  const [mail] = await sql<{ message_id: string; subject: string }>(`SELECT message_id, subject FROM outbound_emails WHERE to_address = $1 AND subject LIKE $2 ORDER BY created_at DESC LIMIT 1`, [requesterEmail, `%${number}%`]);
  const ticketsBefore = (await sql<{ n: number }>(`SELECT count(*)::int AS n FROM tickets`))[0]!.n;
  const raw = [
    `From: ${requesterEmail}`,
    `To: help@northbeam-it.example`,
    `Subject: Re: ${mail!.subject}`,
    `Message-ID: <e2e-reply-${Date.now()}@client.example>`,
    `In-Reply-To: <${mail!.message_id.replace(/^<|>$/g, "")}>`,
    `References: <${mail!.message_id.replace(/^<|>$/g, "")}>`,
    `Date: ${new Date().toUTCString()}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    `Restarting fixed it, thank you!`,
    ``,
    `On Tue, the help desk wrote:`,
    `> Thanks — please restart Outlook`,
  ].join("\r\n");
  const res = await request.post(`/api/inbound/email?secret=e2e-inbound-secret`, { data: raw, headers: { "content-type": "message/rfc822" } });
  expect(res.ok()).toBe(true);

  expect((await sql<{ n: number }>(`SELECT count(*)::int AS n FROM tickets`))[0]!.n).toBe(ticketsBefore);
  await login(page, AGENT);
  await page.goto(`/agent/tickets/${number}`);
  await expect(page.getByText("Restarting fixed it, thank you!")).toBeVisible();
  // Quoted history is stripped.
  await expect(page.getByText("On Tue, the help desk wrote")).toHaveCount(0);
});
