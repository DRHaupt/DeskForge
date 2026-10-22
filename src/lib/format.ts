/** Date formatting in the business time zone. Works on server and client (Intl). */
export function formatDateTime(d: Date | string | null | undefined, timeZone: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }, locale = "en"): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone }).format(date);
}

export function formatDate(d: Date | string | null | undefined, timeZone: string, locale = "en"): string {
  return formatDateTime(d, timeZone, { dateStyle: "medium" }, locale);
}

/** "3 hours ago" style relative time. */
export function timeAgo(d: Date | string, now = Date.now()): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const secs = Math.round((date.getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(secs);
  // Seconds would differ between the server render and hydration; keep it coarse.
  if (abs < 60) return secs <= 0 ? "just now" : "in a moment";
  if (abs < 3600) return rtf.format(Math.round(secs / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(secs / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(secs / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(secs / (86400 * 30)), "month");
  return rtf.format(Math.round(secs / (86400 * 365)), "year");
}

/** Minutes → "1h 30m" / "2d 4h". */
export function formatMinutes(mins: number): string {
  const sign = mins < 0 ? "-" : "";
  let m = Math.abs(Math.round(mins));
  const d = Math.floor(m / 1440);
  m -= d * 1440;
  const h = Math.floor(m / 60);
  m -= h * 60;
  const parts = [d ? `${d}d` : "", h ? `${h}h` : "", m || (!d && !h) ? `${m}m` : ""].filter(Boolean);
  return sign + parts.slice(0, 2).join(" ");
}
