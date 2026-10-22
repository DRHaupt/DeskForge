/**
 * Business-hours calendar math in the business's time zone (no external deps).
 *
 * All inputs/outputs are UTC `Date`s; business hours and holidays are wall-clock
 * times in `timezone` (DST-aware via Intl).
 */
import type { BusinessConfig, Weekday } from "../config/schema";

export type Calendar = {
  timezone: string;
  /** Index 0 = Sunday … 6 = Saturday (JS getUTCDay order). Minutes from midnight. */
  hours: { start: number; end: number }[][];
  holidays: Set<string>;
  /** Count every minute (24/7) instead of business hours. */
  always: boolean;
};

const DAY_KEYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MAX_DAYS = 800;

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};

export function calendarFromConfig(cfg: BusinessConfig, always = false): Calendar {
  const hours = DAY_KEYS.map((k) => (cfg.locale.businessHours[k] ?? []).map((r) => ({ start: toMinutes(r.start), end: toMinutes(r.end) })).sort((a, b) => a.start - b.start));
  return { timezone: cfg.locale.timezone, hours, holidays: new Set(cfg.locale.holidays.map((h) => h.date)), always };
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of `date` in `tz`. */
export function zonedParts(date: Date, tz: string) {
  const parts = Object.fromEntries(formatter(tz).formatToParts(date).map((p) => [p.type, p.value]));
  return { year: +parts.year!, month: +parts.month!, day: +parts.day!, hour: +parts.hour!, minute: +parts.minute!, second: +parts.second! };
}

/** Offset (minutes) of `tz` from UTC at instant `date`. */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** UTC instant for a wall-clock time in `tz`. Times in a DST gap move forward. */
export function zonedToUtc(year: number, month: number, day: number, minutesOfDay: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day, 0, minutesOfDay);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  let result = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(result), tz);
  if (off2 !== off1) result = guess - off2 * 60000;
  return new Date(result);
}

function isoDate(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Business intervals (UTC) for the local calendar day `offset` days after `from`'s local date. */
function intervalsForDay(from: Date, offset: number, cal: Calendar): [number, number][] {
  const p = zonedParts(from, cal.timezone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + offset));
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if (cal.holidays.has(isoDate(y, m, day))) return [];
  return cal.hours[d.getUTCDay()]!.map((r) => [zonedToUtc(y, m, day, r.start, cal.timezone).getTime(), zonedToUtc(y, m, day, r.end, cal.timezone).getTime()]);
}

function hasAnyHours(cal: Calendar) {
  return cal.hours.some((d) => d.length > 0);
}

/** `start` + `minutes` of business time. */
export function addBusinessMinutes(start: Date, minutes: number, cal: Calendar): Date {
  if (cal.always || !hasAnyHours(cal)) return new Date(start.getTime() + minutes * 60000);
  if (minutes <= 0) return new Date(start);
  let remaining = minutes * 60000;
  const cursor = start.getTime();
  for (let i = 0; i < MAX_DAYS; i++) {
    for (const [s, e] of intervalsForDay(start, i, cal)) {
      if (e <= cursor) continue;
      const from = Math.max(s, cursor);
      const avail = e - from;
      if (avail >= remaining) return new Date(from + remaining);
      remaining -= avail;
    }
  }
  throw new Error("SLA calendar has no business hours in the next 800 days (check holidays/business hours)");
}

/** Business minutes between `a` and `b` (0 if b <= a). */
export function businessMinutesBetween(a: Date, b: Date, cal: Calendar): number {
  if (b.getTime() <= a.getTime()) return 0;
  if (cal.always || !hasAnyHours(cal)) return (b.getTime() - a.getTime()) / 60000;
  let total = 0;
  for (let i = 0; i < MAX_DAYS; i++) {
    const intervals = intervalsForDay(a, i, cal);
    for (const [s, e] of intervals) {
      const from = Math.max(s, a.getTime());
      const to = Math.min(e, b.getTime());
      if (to > from) total += to - from;
    }
    // Stop once the next local day starts after b.
    const p = zonedParts(a, cal.timezone);
    const nextDayStart = zonedToUtc(p.year, p.month, p.day + i + 1, 0, cal.timezone).getTime();
    if (nextDayStart >= b.getTime()) break;
  }
  return total / 60000;
}

/** Is `at` inside business hours? */
export function isBusinessTime(at: Date, cal: Calendar): boolean {
  if (cal.always || !hasAnyHours(cal)) return true;
  return intervalsForDay(at, 0, cal).some(([s, e]) => at.getTime() >= s && at.getTime() < e);
}
