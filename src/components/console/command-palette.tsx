"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Inbox, Plus, Search, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Highlight } from "./highlight";

type Results = {
  tickets: { id: string; number: string; title: string; snippet: string }[];
  articles: { id: string; slug: string; title: string; snippet: string }[];
};

const SHORTCUTS: [string, string][] = [
  ["/ or Ctrl+K", "Search and jump"],
  ["c", "New ticket"],
  ["g then t", "Go to tickets"],
  ["g then h", "Go home"],
  ["j / k", "Next / previous ticket in a list"],
  ["x", "Select ticket in a list"],
  ["Enter / o", "Open ticket"],
  ["r", "Reply (on a ticket)"],
  ["n", "Internal note (on a ticket)"],
  ["Ctrl+Enter", "Send reply / note"],
  ["?", "Show this help"],
];

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

export function CommandPalette({ kb }: { kb: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Results>({ tickets: [], articles: [] });
  const gPressed = useRef(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing(e))) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setHelp(true);
      } else if (e.key === "c") {
        e.preventDefault();
        router.push("/agent/tickets/new");
      } else if (e.key === "g") {
        gPressed.current = Date.now();
      } else if (Date.now() - gPressed.current < 1000) {
        if (e.key === "t") router.push("/agent/tickets");
        if (e.key === "h") router.push("/agent");
        gPressed.current = 0;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setRes({ tickets: [], articles: [] });
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/v1/search?q=${encodeURIComponent(q)}&limit=8`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { tickets: [], articles: [] }))
        .then(setRes)
        .catch(() => undefined);
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };
  const looksLikeNumber = /^[A-Za-z]{2,6}\d{1,12}$/.test(q.trim());

  return (
    <>
      <Button variant="outline" className="h-9 w-full max-w-sm justify-start gap-2 text-muted-foreground" onClick={() => setOpen(true)} aria-keyshortcuts="Control+K /">
        <Search className="size-4" />
        <span className="flex-1 text-left">Search tickets & articles…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search tickets and knowledge base articles">
        <CommandInput placeholder="Type a ticket number, keywords…" value={q} onValueChange={setQ} />
        <CommandList>
          <CommandEmpty>{q.length < 2 ? "Type at least two characters." : "No results."}</CommandEmpty>
          {looksLikeNumber && (
            <CommandGroup heading="Jump to">
              <CommandItem value={`jump ${q}`} onSelect={() => go(`/agent/tickets/${q.trim().toUpperCase()}`)}>
                <Ticket /> Open {q.trim().toUpperCase()}
              </CommandItem>
            </CommandGroup>
          )}
          {res.tickets.length > 0 && (
            <CommandGroup heading="Tickets">
              {res.tickets.map((t) => (
                <CommandItem key={t.id} value={`ticket ${t.number} ${t.title} ${q}`} onSelect={() => go(`/agent/tickets/${t.number}`)}>
                  <Ticket className="shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate">
                      <span className="mr-2 font-mono text-xs text-muted-foreground">{t.number}</span>
                      {t.title}
                    </div>
                    {t.snippet && (
                      <div className="truncate text-xs text-muted-foreground">
                        <Highlight text={t.snippet} />
                      </div>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {kb && res.articles.length > 0 && (
            <CommandGroup heading="Knowledge base">
              {res.articles.map((a) => (
                <CommandItem key={a.id} value={`article ${a.title} ${q}`} onSelect={() => go(`/agent/kb/${a.slug}`)}>
                  <BookOpen /> {a.title}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading="Actions">
            {q.length >= 2 && (
              <CommandItem value={`all results ${q}`} onSelect={() => go(`/agent/search?q=${encodeURIComponent(q)}`)}>
                <Search /> See all results for “{q}”
              </CommandItem>
            )}
            <CommandItem value="new ticket create" onSelect={() => go("/agent/tickets/new")}>
              <Plus /> New ticket
            </CommandItem>
            <CommandItem value="my tickets queue" onSelect={() => go("/agent/tickets?view=mine")}>
              <Inbox /> My open tickets
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            {SHORTCUTS.map(([k, d]) => (
              <div key={k} className="contents">
                <dt>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">{k}</kbd>
                </dt>
                <dd className="text-muted-foreground">{d}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
