import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseBusinessConfigYaml } from "@/core/config/loader";
import { cabOutcome, cabRequired, cabStates } from "@/core/itsm/cab";
import { assetRowSchema, csvCell, mapAssetCsv, parseCsv, toCsv } from "@/core/assets/csv";
import { columnIndexForStatus, needsRebalance, rankBetween } from "@/core/boards/board";

const load = (f: string) => parseBusinessConfigYaml(fs.readFileSync(path.resolve(import.meta.dirname, `../../examples/${f}`), "utf8"));
const msp = load("msp-it-support.yaml");
const internal = load("internal-it.yaml");

describe("CAB rules", () => {
  it("reads the awaiting/approved/rejected states from the change workflow", () => {
    expect(cabStates(msp.ticketTypes.find((t) => t.key === "change")!)).toEqual({ awaiting: "awaiting_approval", approved: "approved", rejected: "rejected" });
    expect(cabStates(msp.ticketTypes.find((t) => t.key === "incident")!)).toBeNull();
  });
  it("requires review for configured risks and unknown risk", () => {
    expect(cabRequired(msp, "low")).toBe(false);
    expect(cabRequired(msp, "high")).toBe(true);
    expect(cabRequired(msp, null)).toBe(true);
  });
  it("one rejection rejects; quorum approves; quorum capped at voters", () => {
    expect(cabOutcome(["APPROVED", "REJECTED"], 1)).toBe("REJECTED");
    expect(cabOutcome(["APPROVED", "PENDING"], 2)).toBe("PENDING");
    expect(cabOutcome(["APPROVED", "APPROVED", "PENDING"], 2)).toBe("APPROVED");
    expect(cabOutcome(["APPROVED"], 3)).toBe("APPROVED");
    expect(cabOutcome(["APPROVED", "NOT_REQUIRED"], 2)).toBe("APPROVED");
    expect(cabOutcome([], 1)).toBe("PENDING");
  });
});

describe("CSV", () => {
  it("parses quotes, escaped quotes, embedded newlines, CRLF and BOM", () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\n1,,3');
    expect(rows).toEqual([["a", "b", "c"], ["x, y", 'say "hi"', "line1\nline2"], ["1", "", "3"]]);
  });
  it("round-trips through toCsv and neutralises formulas", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell('a"b')).toBe('"a""b"');
    const text = toCsv(["h1", "h2"], [["v, 1", null]]);
    expect(parseCsv(text)).toEqual([["h1", "h2"], ["v, 1", ""]]);
  });
  it("maps header aliases and keeps unknown columns as attributes", () => {
    const m = mapAssetCsv("Asset Tag,Hostname,Type,Serial Number,Assigned To,RAM\nLT-1,ws-01,Laptop,SN1,a@b.example,16GB");
    expect(m.headers).toEqual(["tag", "name", "assetType", "serialNumber", "owner", null]);
    expect(m.extras).toEqual(["RAM"]);
    expect(m.rows[0]).toEqual({ line: 2, data: { tag: "LT-1", name: "ws-01", assetType: "Laptop", serialNumber: "SN1", owner: "a@b.example", "attr:RAM": "16GB" } });
  });
  it("validates rows with friendly status and date handling", () => {
    const ok = assetRowSchema.parse({ tag: "A", name: "n", assetType: "t", status: "In Repair", purchaseDate: "2025-01-31" });
    expect(ok.status).toBe("in_repair");
    expect(ok.purchaseDate?.toISOString()).toBe("2025-01-31T00:00:00.000Z");
    expect(assetRowSchema.parse({ tag: "A", name: "n", assetType: "t", status: "" }).status).toBe("in_use");
    expect(assetRowSchema.safeParse({ tag: "A", name: "n", assetType: "t", status: "lost" }).success).toBe(false);
    expect(assetRowSchema.safeParse({ tag: "A", name: "n", assetType: "t", status: "", purchaseDate: "soon" }).success).toBe(false);
  });
});

describe("boards", () => {
  const board = internal.boards[0]!;
  it("finds the column for a status", () => {
    expect(columnIndexForStatus(board, "doing")).toBe(2);
    expect(columnIndexForStatus(board, "nope")).toBe(-1);
  });
  it("ranks between neighbours", () => {
    expect(rankBetween(1, 3)).toBe(2);
    expect(rankBetween(5, null)).toBe(5 + 1024);
    expect(rankBetween(null, 5)).toBe(5 - 1024);
    expect(rankBetween(null, null)).toBe(0);
    expect(needsRebalance(1, 1 + 1e-9)).toBe(true);
    expect(needsRebalance(1, 2)).toBe(false);
  });
});

import { dayKeys, formatDuration, percentile, startOfLocalDay } from "@/core/reports/stats";
describe("report helpers", () => {
  it("finds local midnight across zones and DST", () => {
    const now = new Date("2026-10-22T03:00:00Z"); // 21 Oct 23:00 in New York
    expect(startOfLocalDay(now, 0, "America/New_York").toISOString()).toBe("2026-10-21T04:00:00.000Z");
    expect(startOfLocalDay(now, 6, "Europe/London").toISOString()).toBe("2026-10-15T23:00:00.000Z");
    // Across the US DST end (1 Nov 2026)
    expect(startOfLocalDay(new Date("2026-11-03T15:00:00Z"), 3, "America/New_York").toISOString()).toBe("2026-10-31T04:00:00.000Z");
    expect(dayKeys(startOfLocalDay(now, 6, "Asia/Tokyo"), now, "Asia/Tokyo")).toHaveLength(7);
  });
  it("percentiles and durations", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(200)).toBe("3h 20m");
    expect(formatDuration(3000)).toBe("2d 2h");
  });
});
