import * as React from "react";
import { cn } from "@/lib/utils";

/** Initials avatar with a stable color derived from the name. */
function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white", className)}
      style={{ backgroundColor: `hsl(${hue} 45% 40%)` }}
    >
      {initials || "?"}
    </span>
  );
}

export { Avatar };
