/** Small pure helpers for reports. */

export const RANGE_PRESETS = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type RangePreset = keyof typeof RANGE_PRESETS;

/** Percentile (0–1) by linear interpolation; null for empty input. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo]! + (s[hi]! - s[lo]!) * (idx - lo);
}

/** YYYY-MM-DD for a date in a time zone. */
export function dayKey(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Minutes the time zone is ahead of UTC at a given instant. */
function tzOffsetMinutes(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The UTC instant of local midnight starting `daysBack` days before `now`'s local day. */
export function startOfLocalDay(now: Date, daysBack: number, timeZone: string): Date {
  const [y, m, d] = dayKey(now, timeZone).split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d - daysBack);
  // Correct by the zone offset; re-check once in case midnight sits near a DST change.
  let t = guess - tzOffsetMinutes(new Date(guess), timeZone) * 60_000;
  t = guess - tzOffsetMinutes(new Date(t), timeZone) * 60_000;
  return new Date(t);
}

/** Every day key from `from` to `to` inclusive (in the time zone). */
export function dayKeys(from: Date, to: Date, timeZone: string): string[] {
  const out: string[] = [];
  const end = dayKey(to, timeZone);
  // Step in 6h increments and dedupe, so DST shifts can't skip a day.
  for (let t = from.getTime(); ; t += 6 * 3600_000) {
    const k = dayKey(new Date(t), timeZone);
    if (out[out.length - 1] !== k) out.push(k);
    if (k >= end) break;
  }
  return out;
}

/** Zero-filled daily series from sparse { day, n } rows. */
export function fillSeries(keys: string[], rows: { day: string; n: number }[]): number[] {
  const m = new Map(rows.map((r) => [r.day, Number(r.n)]));
  return keys.map((k) => m.get(k) ?? 0);
}

export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/** "45m", "3h 20m", "2d 4h". */
export function formatDuration(mins: number | null): string {
  if (mins === null || !Number.isFinite(mins)) return "—";
  const m = Math.round(mins);
  if (m < 60) return `${m}m`;
  if (m < 24 * 60) return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
  const d = Math.floor(m / 1440);
  const h = Math.round((m % 1440) / 60);
  return `${d}d${h ? ` ${h}h` : ""}`;
}

/** 1,284 / 12.9K / 4.2M */
export function compact(n: number): string {
  if (Math.abs(n) < 1000) return n.toLocaleString("en");
  if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** Round an axis maximum up to a clean value (1, 2, 5 × 10^n). */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
