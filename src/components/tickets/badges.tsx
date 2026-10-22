import { cn } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  NEW: "#6366f1",
  OPEN: "#2563eb",
  PENDING: "#d97706",
  RESOLVED: "#16a34a",
  CLOSED: "#64748b",
};

export function StatusBadge({ label, color, category, className }: { label: string; color?: string; category?: string; className?: string }) {
  const c = color ?? (category ? CATEGORY_COLORS[category] : undefined) ?? "#64748b";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", className)} style={{ borderColor: `${c}55`, backgroundColor: `${c}14`, color: c }}>
      <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: c }} />
      {label}
    </span>
  );
}

export function PriorityBadge({ label, color, className }: { label: string; color?: string; className?: string }) {
  const c = color ?? "#64748b";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap", className)}>
      <span aria-hidden className="inline-block h-3 w-1 rounded-sm" style={{ backgroundColor: c }} />
      {label}
    </span>
  );
}
