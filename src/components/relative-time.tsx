import { timeAgo } from "@/lib/format";

/**
 * "3 minutes ago", with the exact time on hover. Relative text can legitimately
 * change between the server render and hydration, so the mismatch is expected.
 */
export function RelativeTime({ date, className }: { date: Date | string; className?: string }) {
  const d = typeof date === "string" ? new Date(date) : date;
  return (
    <time dateTime={d.toISOString()} title={d.toISOString().replace("T", " ").slice(0, 16) + " UTC"} className={className} suppressHydrationWarning>
      {timeAgo(d)}
    </time>
  );
}
