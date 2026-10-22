"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Card = { id: string; number: string; title: string; status: string; priority: string; dueAt: string | null; assignee: { id: string; name: string } | null; tags: { tag: { name: string } }[]; type: { key: string; name: string } };
type Column = { name: string; states: string[]; wipLimit: number | null; cards: Card[] };

export function Board({ boardKey, columns: initial, priorities }: { boardKey: string; columns: Column[]; priorities: Record<string, { name: string; color: string | null }> }) {
  const router = useRouter();
  const [columns, setColumns] = useState(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ col: number; index: number } | null>(null);
  const [live, setLive] = useState("");
  useEffect(() => setColumns(initial), [initial]);

  async function move(cardId: string, toCol: number, toIndex: number) {
    const fromCol = columns.findIndex((c) => c.cards.some((x) => x.id === cardId));
    if (fromCol < 0) return;
    const card = columns[fromCol]!.cards.find((x) => x.id === cardId)!;
    // Optimistic update
    const next = columns.map((c) => ({ ...c, cards: c.cards.filter((x) => x.id !== cardId) }));
    const target = next[toCol]!.cards;
    const index = Math.min(toIndex, target.length);
    target.splice(index, 0, card);
    const prev = columns;
    setColumns(next);
    try {
      const r = await api<{ status: string }>(`/api/v1/boards/${boardKey}/move`, {
        body: { ticketId: cardId, column: toCol, afterId: target[index - 1]?.id ?? null, beforeId: target[index + 1]?.id ?? null },
      });
      setColumns((cols) => cols.map((c) => ({ ...c, cards: c.cards.map((x) => (x.id === cardId ? { ...x, status: r.status } : x)) })));
      setLive(`${card.number} moved to ${next[toCol]!.name}`);
      router.refresh();
    } catch (err) {
      setColumns(prev);
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: "60vh" }}>
      <p aria-live="polite" className="sr-only">
        {live}
      </p>
      {columns.map((col, ci) => {
        const overLimit = col.wipLimit !== null && col.cards.length > col.wipLimit;
        return (
          <section
            key={col.name}
            aria-label={`${col.name}, ${col.cards.length} cards`}
            className={cn("flex w-72 shrink-0 flex-col rounded-lg border bg-muted/40", over?.col === ci && "ring-2 ring-primary/40")}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              if (over?.col !== ci) setOver({ col: ci, index: col.cards.length });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging && over) void move(dragging, over.col, over.index);
              setDragging(null);
              setOver(null);
            }}
          >
            <header className="flex items-center justify-between px-3 py-2">
              <h2 className="text-sm font-semibold">{col.name}</h2>
              <span className={cn("text-xs", overLimit ? "font-semibold text-destructive" : "text-muted-foreground")} title={col.wipLimit !== null ? `Work-in-progress limit ${col.wipLimit}` : undefined}>
                {col.cards.length}
                {col.wipLimit !== null && ` / ${col.wipLimit}`}
              </span>
            </header>
            <ol className="flex flex-1 flex-col gap-2 px-2 pb-2">
              {col.cards.map((card, i) => (
                <li
                  key={card.id}
                  draggable
                  onDragStart={(e) => {
                    setDragging(card.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", card.number);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                  onDragOver={(e) => {
                    if (!dragging) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const index = e.clientY < rect.top + rect.height / 2 ? i : i + 1;
                    if (over?.col !== ci || over.index !== index) setOver({ col: ci, index });
                  }}
                  className={cn(
                    "group rounded-md border bg-card p-2.5 text-sm shadow-xs",
                    dragging === card.id && "opacity-40",
                    over?.col === ci && dragging && dragging !== card.id && over.index === i && "border-t-2 border-t-primary",
                  )}
                >
                  <div className="flex items-start justify-between gap-1">
                    <Link href={`/agent/tickets/${card.number}`} className="font-medium leading-snug hover:underline">
                      {card.title}
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label={`Move ${card.number}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Move to</DropdownMenuLabel>
                        {columns.map((c, j) =>
                          j === ci ? null : (
                            <DropdownMenuItem key={c.name} onSelect={() => void move(card.id, j, c.cards.length)}>
                              {c.name}
                            </DropdownMenuItem>
                          ),
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={i === 0} onSelect={() => void move(card.id, ci, 0)}>
                          Top of column
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={i === col.cards.length - 1} onSelect={() => void move(card.id, ci, col.cards.length)}>
                          Bottom of column
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{card.number}</span>
                    <Badge variant="outline" style={priorities[card.priority]?.color ? { borderColor: priorities[card.priority]!.color!, color: priorities[card.priority]!.color! } : undefined}>
                      {priorities[card.priority]?.name ?? card.priority}
                    </Badge>
                    {card.tags.slice(0, 3).map((t) => (
                      <Badge key={t.tag.name} variant="secondary">
                        {t.tag.name}
                      </Badge>
                    ))}
                    <span className="ml-auto">{card.assignee?.name ?? "Unassigned"}</span>
                  </div>
                </li>
              ))}
              {col.cards.length === 0 && <li className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">Drop cards here</li>}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
