"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Highlight } from "@/components/console/highlight";

type Hit = { id: string; slug: string; title: string; snippet: string };

/** Search box with live article suggestions. Enter goes to the full results page. */
export function KbSearch({ placeholder = "Search help articles…", autoFocus = false, initial = "" }: { placeholder?: string; autoFocus?: boolean; initial?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (q.trim().length < 3) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/v1/kb/suggest?q=${encodeURIComponent(q)}&limit=6`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { articles: [] }))
        .then((d) => setHits(d.articles))
        .catch(() => undefined);
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  return (
    <form
      role="search"
      className="relative w-full"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/portal/kb?q=${encodeURIComponent(q)}`);
      }}
    >
      <label htmlFor="kb-q" className="sr-only">
        Search help articles
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        id="kb-q"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls="kb-suggestions"
        placeholder={placeholder}
        className="h-14 w-full rounded-xl border border-input bg-background pr-4 pl-12 text-base shadow-sm focus-visible:outline-2 focus-visible:outline-ring"
      />
      {open && hits.length > 0 && (
        <ul id="kb-suggestions" role="listbox" className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border bg-popover text-left shadow-lg">
          {hits.map((h) => (
            <li key={h.id} role="option" aria-selected={false}>
              <Link href={`/portal/kb/${h.slug}`} className="block px-4 py-3 hover:bg-accent">
                <span className="font-medium">{h.title}</span>
                <span className="mt-0.5 line-clamp-1 block text-sm text-muted-foreground">
                  <Highlight text={h.snippet} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
