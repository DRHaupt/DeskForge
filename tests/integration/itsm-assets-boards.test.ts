import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/server/session", () => ({ getCurrentActor: async () => null }));

import { db } from "@/server/db";
import { syncConfigToDatabase } from "@/server/config-sync";
import { createAsset, deleteAsset, exportAssetsCsv, getAsset, importAssets, listAssets, listMyAssets, assetFilterSchema } from "@/server/services/assets";
import { getBoard, moveCard } from "@/server/services/boards";
import { createTicket, getTicket } from "@/server/services/tickets";
import { GET as exportRoute } from "@/app/api/v1/assets/export/route";
import { POST as importRoute } from "@/app/api/v1/assets/import/route";
import { ConflictError, ForbiddenError, ValidationError } from "@/core/errors";
import type { UserActor } from "@/core/rbac/actor";
import { actorFor, apiKeyFor, makeUser, params, req, setupBusiness } from "./helpers";

let lead: UserActor, agent: UserActor, member: UserActor, other: UserActor;
let leadKey: string, memberKey: string;

beforeAll(async () => {
  const cfg = await setupBusiness("internal-it");
  const l = await makeUser("alex.morgan@riverside-club.example", ["team_lead"], { name: "Alex Morgan" });
  const a = await makeUser("taylor.brooks@riverside-club.example", ["agent"], { name: "Taylor Brooks" });
  const m = await makeUser("member@riverside-club.example", ["requester"], { name: "Club Member" });
  const o = await makeUser("other@riverside-club.example", ["requester"], { name: "Other Member" });
  await syncConfigToDatabase(db, cfg);
  [lead, agent, member, other] = await Promise.all([actorFor(l.id), actorFor(a.id), actorFor(m.id), actorFor(o.id)]);
  leadKey = await apiKeyFor(l.id);
  memberKey = await apiKeyFor(m.id);
});

const CSV = `Asset Tag,Name,Type,Status,Serial,Assigned To,Purchase Date,RAM
LT-001,Front desk laptop,Laptop,In use,SN-A1,member@riverside-club.example,2024-03-01,16GB
LT-002,"Spare laptop, shelf 2",Laptop,in_stock,SN-A2,,2023-11-15,8GB
PR-001,Office printer,Printer,in_use,,nobody@riverside-club.example,,
`;

describe("assets", () => {
  it("previews an import without writing", async () => {
    const r = await importAssets(lead, { csv: CSV, dryRun: true });
    expect(r).toMatchObject({ created: 2, updated: 0, dryRun: true, extras: ["RAM"] });
    expect(r.errors).toEqual([{ line: 4, message: expect.stringContaining("nobody@riverside-club.example") }]);
    expect(await db.asset.count()).toBe(0);
  });

  it("imports, then updates by tag", async () => {
    const res = await importRoute(req("/api/v1/assets/import", { body: { csv: CSV }, key: leadKey }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 2, updated: 0 });
    const lt1 = await getAsset(lead, "LT-001");
    expect(lt1.owner?.email).toBe("member@riverside-club.example");
    expect(lt1.attributes).toEqual({ RAM: "16GB" });
    expect(lt1.purchaseDate?.toISOString().slice(0, 10)).toBe("2024-03-01");

    const again = await importAssets(lead, { csv: "tag,name,type,status\nLT-002,Spare laptop,Laptop,in_repair\n" });
    expect(again).toMatchObject({ created: 0, updated: 1 });
    expect((await getAsset(lead, "LT-002")).status).toBe("in_repair");
  });

  it("rejects files without required columns and enforces permissions", async () => {
    await expect(importAssets(lead, { csv: "name,type\nx,y\n" })).rejects.toThrow(/tag/);
    await expect(importAssets(agent, { csv: CSV })).rejects.toBeInstanceOf(ForbiddenError);
    const res = await importRoute(req("/api/v1/assets/import", { body: { csv: CSV }, key: memberKey }), params());
    expect(res.status).toBe(403);
  });

  it("lists, filters and exports", async () => {
    const list = await listAssets(agent, assetFilterSchema.parse({ q: "front" }));
    expect(list.items.map((a) => a.tag)).toEqual(["LT-001"]);
    expect(list.types).toEqual(["Laptop"]);
    const res = await exportRoute(req("/api/v1/assets/export?type=Laptop", { key: leadKey }), params());
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text.split("\r\n")[0]).toContain("tag,name,type");
    expect(text).toContain("LT-001,Front desk laptop,Laptop,in_use");
    expect(await exportAssetsCsv(lead, { status: "in_stock" })).not.toContain("LT-");
  });

  it("lets requesters pick only their own assets on new tickets", async () => {
    const mine = await listMyAssets(member);
    expect(mine.map((a) => a.tag)).toEqual(["LT-001"]);
    const { id } = await createTicket(member, { type: "incident", title: "Laptop won't charge", fields: { location: "Lab A" }, assetIds: [mine[0]!.id] });
    const t = await getTicket(lead, id);
    expect(t.outgoingLinks.map((l) => l.targetAsset?.tag)).toEqual(["LT-001"]);
    expect((await getAsset(lead, "LT-001")).relationships.map((r) => r.sourceTicket.id)).toContain(id);
    const spare = await getAsset(lead, "LT-002");
    await expect(createTicket(other, { type: "incident", title: "Not my laptop", fields: { location: "Lab A" }, assetIds: [mine[0]!.id] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createTicket(member, { type: "incident", title: "Spare laptop", fields: { location: "Lab A" }, assetIds: [spare.id] })).rejects.toBeInstanceOf(ValidationError);
    // The asset custom field follows the same rule and links the asset.
    await expect(createTicket(member, { type: "incident", title: "Spare laptop", fields: { location: "Lab A", device: spare.id } })).rejects.toBeInstanceOf(ValidationError);
    const viaField = await createTicket(member, { type: "incident", title: "Laptop screen flickers", fields: { location: "Lab B", device: mine[0]!.id } });
    expect((await getTicket(lead, viaField.id)).outgoingLinks.map((l) => l.targetAsset?.tag)).toEqual(["LT-001"]);
  });

  it("soft-deletes and frees the tag", async () => {
    const { id } = await createAsset(lead, { tag: "MON-1", name: "Monitor", assetType: "Monitor" });
    await expect(createAsset(lead, { tag: "MON-1", name: "Dup", assetType: "Monitor" })).rejects.toBeInstanceOf(ConflictError);
    await deleteAsset(lead, id);
    expect((await listAssets(lead, assetFilterSchema.parse({ q: "MON-1" }))).total).toBe(0);
    await expect(createAsset(lead, { tag: "MON-1", name: "Replacement", assetType: "Monitor" })).resolves.toMatchObject({ tag: "MON-1" });
  });
});

describe("agile board", () => {
  let a: string, b: string, c: string;
  beforeAll(async () => {
    a = (await createTicket(lead, { type: "task", title: "Replace lab switch" })).id;
    b = (await createTicket(lead, { type: "task", title: "Draft Wi-Fi survey" })).id;
    c = (await createTicket(lead, { type: "task", title: "Update website footer" })).id;
  });

  it("groups tasks into the configured columns", async () => {
    const board = await getBoard(agent, "it_projects");
    expect(board.columns.map((col) => col.name)).toEqual(["Backlog", "To Do", "Doing", "Review", "Done"]);
    expect(board.columns[0]!.cards).toHaveLength(3);
    expect(board.columns[2]!.wipLimit).toBe(4);
    await expect(getBoard(member, "it_projects")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("moving a card transitions the ticket and orders it", async () => {
    const r = await moveCard(agent, "it_projects", { ticketId: a, column: 2 });
    expect(r.status).toBe("doing");
    expect((await getTicket(lead, a)).status).toBe("doing");
    await moveCard(agent, "it_projects", { ticketId: b, column: 2, afterId: a });
    await moveCard(agent, "it_projects", { ticketId: c, column: 2, afterId: null, beforeId: a });
    const board = await getBoard(agent, "it_projects");
    expect(board.columns[2]!.cards.map((x) => x.id)).toEqual([c, a, b]);
    // Reordering within a column keeps the status
    await moveCard(agent, "it_projects", { ticketId: c, column: 2, afterId: b });
    expect((await getBoard(agent, "it_projects")).columns[2]!.cards.map((x) => x.id)).toEqual([a, b, c]);
  });

  it("rejects unknown boards and columns", async () => {
    await expect(getBoard(agent, "nope")).rejects.toThrow(/Board/);
    await expect(moveCard(agent, "it_projects", { ticketId: a, column: 9 })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("ITSM API routes", () => {
  it("serve boards and my assets over HTTP", async () => {
    const { GET: boardsRoute } = await import("@/app/api/v1/boards/route");
    const { GET: boardRoute } = await import("@/app/api/v1/boards/[key]/route");
    const { GET: myAssetsRoute } = await import("@/app/api/v1/me/assets/route");
    const agentKey = await apiKeyFor(agent.id);
    expect(await (await boardsRoute(req("/api/v1/boards", { key: agentKey }), params())).json()).toEqual([expect.objectContaining({ key: "it_projects" })]);
    const board = await (await boardRoute(req("/api/v1/boards/it_projects", { key: agentKey }), params({ key: "it_projects" }))).json();
    expect(board.columns).toHaveLength(5);
    expect((await boardsRoute(req("/api/v1/boards", { key: memberKey }), params())).status).toBe(403);
    const mine = await (await myAssetsRoute(req("/api/v1/me/assets", { key: memberKey }), params())).json();
    expect(mine.map((a: { tag: string }) => a.tag)).toContain("LT-001");
  });
});
