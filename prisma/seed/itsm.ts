/** Demo assets, problems, changes and board tasks, derived from the business config. */
import type { BusinessConfig, TicketTypeConfig } from "../../src/core/config/schema";
import type { Actor } from "../../src/core/rbac/actor";
import { cabStates } from "../../src/core/itsm/cab";
import { fillRequiredFields } from "../../src/core/tickets/fields";
import type { Db } from "../../src/server/db";
import { loadUserActor } from "../../src/server/actor";
import { decideApproval } from "../../src/server/services/catalog";
import { raiseProblem } from "../../src/server/services/problems";
import { createTicket, linkTicket, transitionTicket, updateTicket } from "../../src/server/services/tickets";

async function firstActor(db: Db, roleKeys: string[], extra: object = {}): Promise<Actor | null> {
  const u = await db.user.findFirst({ where: { isActive: true, roles: { some: { role: { key: { in: roleKeys } } } }, ...extra }, orderBy: { createdAt: "asc" } });
  return u ? loadUserActor(db, u.id) : null;
}

/** Move a ticket to the first reachable state of a category (one hop). */
async function moveTo(actor: Actor, type: TicketTypeConfig, ticketId: string, status: string, category: string, comment?: string) {
  const states = type.workflow.states;
  const t = type.workflow.transitions.find((x) => (x.from.includes(status) || x.from.includes("*")) && states.find((s) => s.key === x.to)?.category === category);
  if (!t) return status;
  return (await transitionTicket(actor, ticketId, { to: t.to, comment: t.requireComment ? (comment ?? "<p>Done.</p>") : undefined })).status;
}

export async function seedItsm(db: Db, cfg: BusinessConfig): Promise<void> {
  if (cfg.features.assets) await seedAssets(db, cfg);
  if (cfg.features.problemManagement) await seedProblems(db, cfg);
  if (cfg.features.changeManagement) await seedChanges(db, cfg);
  if (cfg.features.agileBoards) await seedBoards(db, cfg);
}

async function seedAssets(db: Db, cfg: BusinessConfig) {
  if (await db.asset.count()) return;
  const requesters = await db.user.findMany({ where: { roles: { some: { role: { key: "requester" } } } }, orderBy: { createdAt: "asc" }, take: 14 });
  const orgs = await db.organization.findMany({ orderBy: { name: "asc" } });
  const prefix = cfg.branding.shortName?.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "AST";
  const day = 86_400_000;
  const now = Date.now();
  const laptops = [
    ["Dell", "Latitude 7440"],
    ["Lenovo", "ThinkPad T14 Gen 4"],
    ["HP", "EliteBook 840 G10"],
    ["Apple", "MacBook Air 13 M2"],
  ];
  let n = 0;
  const rows: Parameters<typeof db.asset.create>[0]["data"][] = [];
  for (const [i, u] of requesters.entries()) {
    const [make, model] = laptops[i % laptops.length]!;
    const bought = now - (200 + i * 97) * day;
    rows.push({
      tag: `${prefix}-LT-${String(1001 + i)}`,
      name: `${u.name.split(" ")[0]}'s laptop`,
      assetType: "Laptop",
      status: "in_use",
      serialNumber: `SN${(0x5a3c1 * (i + 7)).toString(36).toUpperCase()}`,
      manufacturer: make,
      model,
      ownerId: u.id,
      organizationId: u.organizationId,
      purchaseDate: new Date(bought),
      // Spread warranties so some are expired and some expire soon.
      warrantyExpiresAt: new Date(bought + (i % 4 === 0 ? 400 : i % 4 === 1 ? 3 * 365 : 2 * 365) * day),
      attributes: { RAM: i % 2 ? "16 GB" : "32 GB", OS: make === "Apple" ? "macOS 15" : "Windows 11 Pro" },
    });
  }
  const shared: [string, string, string, string][] = [
    ["Printer", "Brother", "MFC-L8900CDW", "Front office"],
    ["Network switch", "Ubiquiti", "USW-Pro-24-PoE", "Comms cabinet"],
    ["Firewall", "Fortinet", "FortiGate 60F", "Comms cabinet"],
    ["Wireless AP", "Ubiquiti", "U6 Pro", "Meeting room"],
    ["Server", "Dell", "PowerEdge T350", "Comms cabinet"],
    ["NAS", "Synology", "DS923+", "Comms cabinet"],
  ];
  for (const [i, [type, make, model, loc]] of shared.entries()) {
    const org = orgs.length ? orgs[i % orgs.length] : null;
    rows.push({
      tag: `${prefix}-${type.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase()}-${String(201 + i)}`,
      name: `${org ? `${org.name} ` : ""}${type.toLowerCase()}`,
      assetType: type,
      status: "in_use",
      manufacturer: make,
      model,
      location: loc,
      organizationId: org?.id,
      purchaseDate: new Date(now - (500 + i * 60) * day),
      warrantyExpiresAt: new Date(now + (i % 2 ? 40 : 500) * day),
    });
  }
  rows.push({ tag: `${prefix}-LT-0999`, name: "Spare laptop", assetType: "Laptop", status: "in_stock", manufacturer: "Dell", model: "Latitude 5440", location: "IT store room" });
  rows.push({ tag: `${prefix}-LT-0901`, name: "Old laptop (battery failed)", assetType: "Laptop", status: "retired", manufacturer: "HP", model: "ProBook 450 G6", notes: "Data wiped. Waiting for collection by the recycler." });
  for (const data of rows) {
    await db.asset.create({ data });
    n++;
  }

  // Link some open incidents to the requester's laptop.
  const owned = await db.asset.findMany({ where: { ownerId: { not: null } }, select: { id: true, ownerId: true } });
  let links = 0;
  for (const a of owned) {
    const t = await db.ticket.findFirst({ where: { requesterId: a.ownerId!, deletedAt: null, type: { key: { in: cfg.ticketTypes.filter((x) => !x.feature).map((x) => x.key) } } }, orderBy: { createdAt: "desc" } });
    if (!t || links >= 8) continue;
    await db.relationship.create({ data: { type: "AFFECTS_ASSET", sourceTicketId: t.id, targetAssetId: a.id } });
    links++;
  }
  console.log(`  assets: ${n} (${links} linked to tickets)`);
}

async function seedProblems(db: Db, cfg: BusinessConfig) {
  const type = cfg.ticketTypes.find((t) => t.feature === "problemManagement");
  if (!type || (await db.ticket.count({ where: { type: { key: type.key }, knownError: true } }))) return;
  const lead = await firstActor(db, ["team_lead", "admin"]);
  if (!lead) return;
  const incidentTypes = cfg.ticketTypes.filter((t) => !t.feature).map((t) => t.key);
  const incidents = await db.ticket.findMany({ where: { deletedAt: null, mergedIntoId: null, type: { key: { in: incidentTypes } }, statusCategory: { in: ["NEW", "OPEN", "PENDING"] } }, orderBy: { createdAt: "asc" }, take: 5 });
  if (incidents.length < 3) return;

  const p1 = await raiseProblem(lead, incidents[0]!.id, { title: "Users intermittently lose their remote connection", description: "<p>Several reports of the VPN dropping every 20–30 minutes since the last client update.</p>" });
  for (const inc of incidents.slice(1, 3)) await linkTicket(lead, inc.id, { type: "CAUSED_BY", target: p1.number });
  await updateTicket(lead, p1.id, {
    rootCause: "The new VPN client renegotiates keys every 20 minutes and the firewall drops the session if renegotiation overlaps with a DHCP renewal.",
    workaround: "Reconnect from the VPN client's tray icon. To stop it happening, open the client's settings and set 'Rekey interval' to 8 hours.",
    knownError: true,
  });
  await moveTo(lead, type, p1.id, type.workflow.initial, "open");

  const p2 = await raiseProblem(lead, incidents[3]?.id ?? incidents[2]!.id, { title: "Shared mailbox permissions reset overnight" });
  await updateTicket(lead, p2.id, { rootCause: null, workaround: "Re-add the user to the mailbox permissions group; changes apply within 15 minutes." });
  console.log("  problems: 2 (1 known error)");
}

async function seedChanges(db: Db, cfg: BusinessConfig) {
  const type = cfg.ticketTypes.find((t) => t.feature === "changeManagement");
  const states = type && cabStates(type);
  if (!type || !states || (await db.ticket.findFirst({ where: { type: { key: type.key }, title: { startsWith: "Upgrade firewall firmware" } } }))) return;
  const teamKey = type.defaultTeam;
  const author = (await firstActor(db, ["agent"], teamKey ? { teamMemberships: { some: { team: { key: teamKey } } } } : {})) ?? (await firstActor(db, ["team_lead", "admin"]));
  if (!author) return;
  const day = 86_400_000;
  const plan = (title: string, risk: string, inDays: number, changePlan: string, rollbackPlan: string) => ({ title, risk, inDays, changePlan, rollbackPlan });
  const risks = cfg.itsm.riskLevels.map((r) => r.key);
  const low = risks.find((r) => !cfg.itsm.cabRequiredForRisk.includes(r)) ?? risks[0]!;
  const high = cfg.itsm.cabRequiredForRisk[cfg.itsm.cabRequiredForRisk.length - 1] ?? risks[risks.length - 1]!;
  const medium = cfg.itsm.cabRequiredForRisk[0] ?? high;
  const items = [
    plan("Upgrade firewall firmware to the current stable release", high, 5, "1. Back up config\n2. Upload firmware in the maintenance window\n3. Reboot and verify VPN, web filtering and site links", "Boot from the previous firmware partition and restore the config backup."),
    plan("Rotate guest Wi-Fi password", low, 1, "Change the PSK on the controller and update the reception sign.", "Revert to the previous PSK on the controller."),
    plan("Move file shares to the new NAS", medium, 9, "Robocopy shares over two nights, then switch the DFS targets.", "Point DFS back at the old server; it stays read-write until sign-off."),
  ];
  const ids: string[] = [];
  for (const it of items) {
    const { id } = await createTicket(author, { type: type.key, title: it.title, description: `<p>${it.title}.</p>`, fields: fillRequiredFields(type.fields) });
    const start = new Date(Date.now() + it.inDays * day);
    await updateTicket(author, id, { riskLevel: it.risk, changePlan: it.changePlan, rollbackPlan: it.rollbackPlan, plannedStartAt: start.toISOString(), plannedEndAt: new Date(start.getTime() + 2 * 3600_000).toISOString() });
    await transitionTicket(author, id, { to: states.awaiting });
    ids.push(id);
  }
  // Third change: one CAB member approves it.
  const vote = await db.approval.findFirst({ where: { ticketId: ids[2]!, kind: "CHANGE_CAB", status: "PENDING" } });
  if (vote) {
    const voter = await loadUserActor(db, vote.approverId);
    if (voter) await decideApproval(voter, vote.id, { decision: "APPROVED", comment: "Fine — please confirm backups first." });
  }
  console.log("  changes: 3 (1 awaiting CAB)");
}

async function seedBoards(db: Db, cfg: BusinessConfig) {
  for (const board of cfg.boards) {
    const type = cfg.ticketTypes.find((t) => t.key === board.ticketTypes[0]);
    if (!type) continue;
    const lead = board.team ? await firstActor(db, ["team_lead", "agent"], { teamMemberships: { some: { team: { key: board.team } } } }) : await firstActor(db, ["team_lead", "admin"]);
    if (!lead) continue;
    const team = board.team ? await db.team.findUnique({ where: { key: board.team } }) : null;
    const titles = ["Replace the lab switch", "Survey Wi-Fi coverage upstairs", "Refresh the website footer", "Document the backup rota", "Label the patch panel", "Order spare chargers", "Audit shared drive permissions", "Retire the old print server", "Set up a test laptop image", "Write the new-volunteer IT guide"];
    for (const [i, title] of titles.entries()) {
      if (await db.ticket.findFirst({ where: { title, type: { key: type.key } } })) continue;
      const { id } = await createTicket(lead, { type: type.key, title, teamId: team?.id, fields: fillRequiredFields(type.fields) });
      const col = board.columns[i % board.columns.length]!;
      const ticket = await db.ticket.findUniqueOrThrow({ where: { id } });
      if (!col.states.includes(ticket.status)) await transitionTicket(lead, id, { to: col.states[0]! }).catch(() => undefined);
      await db.ticket.update({ where: { id }, data: { boardRank: i * 1024 } });
    }
    console.log(`  board "${board.name}": ${titles.length} tasks`);
  }
}
