import { expect, test } from "@playwright/test";
import { AGENT, AUDITOR, aRequester, eventually, login, portalTicket, sql } from "./helpers";

test("a missed first-response target is flagged as breached", async ({ page, browser }) => {
  await login(page, await aRequester());
  const number = await portalTicket(page, "Printer on floor 2 jams every page");
  // Pretend the response target passed a minute ago; the worker's SLA sweep should notice.
  await sql(
    `UPDATE sla_instances SET due_at = now() - interval '1 minute', warn_at = now() - interval '5 minutes'
     WHERE metric = 'FIRST_RESPONSE' AND status = 'RUNNING' AND ticket_id = (SELECT id FROM tickets WHERE number = $1)`,
    [number],
  );
  await eventually(
    async () => (await sql(`SELECT 1 FROM sla_instances s JOIN tickets t ON t.id = s.ticket_id WHERE t.number = $1 AND s.metric = 'FIRST_RESPONSE' AND s.breached_at IS NOT NULL`, [number]))[0],
    { what: "SLA breach to be recorded" },
  );
  // The Service Desk escalates breached tickets to the Systems team (reassignOnBreach).
  await eventually(async () => (await sql(`SELECT 1 FROM tickets t JOIN teams tm ON tm.id = t.team_id WHERE t.number = $1 AND tm.key = 'systems'`, [number]))[0], { what: "escalation to Systems" });
  // The auditor can see every ticket (and isn't required to use 2FA in this example).
  const viewer = await (await browser.newContext()).newPage();
  await login(viewer, AUDITOR);
  await viewer.goto(`/agent/tickets/${number}`);
  await expect(viewer.getByText(/Response: .* over/)).toBeVisible();
  // Escalation notified someone in the app.
  await eventually(async () => (await sql(`SELECT 1 FROM notifications n JOIN tickets t ON t.id = n.ticket_id WHERE t.number = $1 AND n.type LIKE 'sla.%'`, [number]))[0], { what: "breach notification" });
});

test("automations run on new tickets", async ({ page, browser }) => {
  await login(page, await aRequester());
  // The seeded "Flag urgent wording" automation tags titles mentioning outages.
  const number = await portalTicket(page, "Internet is down for the whole office");
  await eventually(
    async () => (await sql(`SELECT 1 FROM ticket_tags tt JOIN tags g ON g.id = tt.tag_id JOIN tickets t ON t.id = tt.ticket_id WHERE t.number = $1 AND g.name = 'urgent-wording'`, [number]))[0],
    { what: "automation to tag the ticket" },
  );
  const agent = await (await browser.newContext()).newPage();
  await login(agent, AGENT);
  await agent.goto(`/agent/tickets/${number}`);
  await expect(agent.getByText("Flagged automatically")).toBeVisible();
  await expect(agent.getByLabel("Tags")).toHaveValue(/urgent-wording/);
  const [run] = await sql<{ success: boolean }>(`SELECT r.success FROM automation_runs r JOIN tickets t ON t.id = r.ticket_id JOIN automations a ON a.id = r.automation_id WHERE t.number = $1 AND a.name = 'Flag urgent wording'`, [number]);
  expect(run?.success).toBe(true);
});
