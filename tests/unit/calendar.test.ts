import { describe, expect, it } from "vitest";
import { addBusinessMinutes, businessMinutesBetween, isBusinessTime, tzOffsetMinutes, zonedToUtc, type Calendar } from "@/core/sla/calendar";

const nine2five = { start: 9 * 60, end: 17 * 60 };
const cal = (tz: string, holidays: string[] = [], always = false): Calendar => ({
  timezone: tz,
  hours: [[], [nine2five], [nine2five], [nine2five], [nine2five], [nine2five], []],
  holidays: new Set(holidays),
  always,
});
const ny = cal("America/New_York", ["2026-12-25"]);

describe("time zones", () => {
  it("computes offsets including DST", () => {
    expect(tzOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe(-240);
    expect(tzOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "America/New_York")).toBe(-300);
    expect(tzOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "Asia/Kolkata")).toBe(330);
  });
  it("converts wall clock to UTC", () => {
    expect(zonedToUtc(2026, 7, 1, 9 * 60, "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedToUtc(2026, 1, 15, 9 * 60, "Europe/London").toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });
});

describe("business minutes", () => {
  it("adds within the same day", () => {
    // Wed 2026-07-01 10:00 NY = 14:00Z; +2h → 12:00 NY
    expect(addBusinessMinutes(new Date("2026-07-01T14:00:00Z"), 120, ny).toISOString()).toBe("2026-07-01T16:00:00.000Z");
  });
  it("rolls over to the next business day", () => {
    // Wed 16:00 NY + 4h → Thu 12:00 NY (1h Wed + 3h Thu)
    expect(addBusinessMinutes(new Date("2026-07-01T20:00:00Z"), 240, ny).toISOString()).toBe("2026-07-02T16:00:00.000Z");
  });
  it("skips weekends", () => {
    // Fri 16:00 NY + 2h → Mon 10:00 NY
    expect(addBusinessMinutes(new Date("2026-07-03T20:00:00Z"), 120, ny).toISOString()).toBe("2026-07-06T14:00:00.000Z");
  });
  it("starts counting at opening time when created at night", () => {
    // Tue 22:00 NY + 30m → Wed 09:30 NY
    expect(addBusinessMinutes(new Date("2026-07-01T02:00:00Z"), 30, ny).toISOString()).toBe("2026-07-01T13:30:00.000Z");
  });
  it("skips holidays", () => {
    // Thu 2026-12-24 16:00 NY (EST, -5) + 2h → Fri 25th is a holiday → Mon 28th 10:00
    expect(addBusinessMinutes(new Date("2026-12-24T21:00:00Z"), 120, ny).toISOString()).toBe("2026-12-28T15:00:00.000Z");
  });
  it("handles DST transitions", () => {
    // Fri 2026-03-06 16:00 EST + 2h → Mon 03-09 10:00 EDT (DST started Sun 03-08)
    expect(addBusinessMinutes(new Date("2026-03-06T21:00:00Z"), 120, ny).toISOString()).toBe("2026-03-09T14:00:00.000Z");
  });
  it("24/7 calendars count every minute", () => {
    expect(addBusinessMinutes(new Date("2026-07-04T23:00:00Z"), 90, cal("UTC", [], true)).toISOString()).toBe("2026-07-05T00:30:00.000Z");
  });
  it("measures business minutes between two instants", () => {
    // Fri 16:00 → Mon 10:00 NY = 1h + 1h
    expect(businessMinutesBetween(new Date("2026-07-03T20:00:00Z"), new Date("2026-07-06T14:00:00Z"), ny)).toBe(120);
    expect(businessMinutesBetween(new Date("2026-07-06T14:00:00Z"), new Date("2026-07-03T20:00:00Z"), ny)).toBe(0);
    // A full week = 5 × 8h
    expect(businessMinutesBetween(new Date("2026-07-06T04:00:00Z"), new Date("2026-07-13T04:00:00Z"), ny)).toBe(5 * 8 * 60);
  });
  it("add and between are inverse", () => {
    const start = new Date("2026-07-02T19:17:00Z");
    for (const m of [5, 60, 479, 480, 481, 2000]) {
      expect(businessMinutesBetween(start, addBusinessMinutes(start, m, ny), ny)).toBeCloseTo(m, 5);
    }
  });
  it("supports split shifts", () => {
    const split: Calendar = { timezone: "UTC", hours: [[], [{ start: 480, end: 720 }, { start: 780, end: 1020 }], [], [], [], [], []], holidays: new Set(), always: false };
    // Mon 11:00 + 2h → 1h before lunch, lunch 12-13, then 1h → 14:00
    expect(addBusinessMinutes(new Date("2026-07-06T11:00:00Z"), 120, split).toISOString()).toBe("2026-07-06T14:00:00.000Z");
    expect(isBusinessTime(new Date("2026-07-06T12:30:00Z"), split)).toBe(false);
  });
});
