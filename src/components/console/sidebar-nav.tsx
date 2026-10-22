"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NavIcon } from "./icons";
import type { NavSection } from "./nav";

export function SidebarNav({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/agent" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Main" className="flex flex-col gap-5 px-3 py-4">
      {sections.map((section, i) => (
        <div key={section.label ?? i} className="flex flex-col gap-0.5">
          {section.label && <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{section.label}</p>}
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-accent hover:text-accent-foreground",
                isActive(item.href) && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
              )}
            >
              <NavIcon name={item.icon} className="size-4" />
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
