"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/api-client";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

type Item = { id: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };

export function NotificationBell({ portal = false }: { portal?: boolean }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ unread: number; items: Item[] }>({ unread: 0, items: [] });

  const load = useCallback(() => {
    api<{ unread: number; items: Item[] }>("/api/v1/notifications?limit=20").then(setData).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function markAll() {
    await api("/api/v1/notifications", { body: { all: true } });
    load();
  }

  const link = (l: string | null) => (portal && l ? l.replace(/^\/agent\//, "/portal/") : l);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${data.unread ? ` (${data.unread} unread)` : ""}`}>
          <Bell />
          {data.unread > 0 && (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">{data.unread > 99 ? "99+" : data.unread}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {data.unread > 0 && (
            <button className="text-xs text-primary hover:underline" onClick={markAll}>
              Mark all as read
            </button>
          )}
        </div>
        <ul className="max-h-[60vh] overflow-y-auto">
          {data.items.map((n) => (
            <li key={n.id} className={cn("border-b last:border-0", !n.readAt && "bg-primary/5")}>
              <Link
                href={link(n.link) ?? "#"}
                className="block px-4 py-2.5 hover:bg-accent"
                onClick={() => {
                  setOpen(false);
                  if (!n.readAt) void api("/api/v1/notifications", { body: { ids: [n.id] } }).then(load);
                }}
              >
                <p className="text-sm font-medium">{n.title}</p>
                {n.body && <p className="line-clamp-2 text-xs text-muted-foreground">{n.body}</p>}
                <p className="mt-0.5 text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</p>
              </Link>
            </li>
          ))}
          {data.items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
