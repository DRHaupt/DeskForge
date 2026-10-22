import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getConfig } from "@/core/config/loader";
import { NotFoundError } from "@/core/errors";
import { PageHeader } from "@/components/console/console-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireAgent } from "@/server/session";
import { boardFilterSchema, getBoard, listBoards } from "@/server/services/boards";
import { Board } from "./board";

export const metadata: Metadata = { title: "Board" };

export default async function BoardPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { key } = await params;
  const actor = await requireAgent(`/agent/boards/${key}`);
  const sp = await searchParams;
  const filter = boardFilterSchema.safeParse(sp).data ?? {};
  let board;
  try {
    board = await getBoard(actor, key, filter);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const boards = listBoards(actor);
  const cfg = getConfig();
  const priorities = Object.fromEntries(cfg.priorities.levels.map((p) => [p.key, { name: p.name, color: p.color ?? null }]));

  return (
    <>
      <PageHeader
        title={board.name}
        description={`${board.team ? `${board.team.name} · ` : ""}Drag cards between columns, or use a card's menu. Moving a card changes the ticket's status.`}
        actions={
          boards.length > 1 && (
            <nav aria-label="Boards" className="flex gap-2">
              {boards.map((b) => (
                <Button key={b.key} asChild size="sm" variant={b.key === key ? "secondary" : "ghost"}>
                  <Link href={`/agent/boards/${b.key}`} aria-current={b.key === key ? "page" : undefined}>
                    {b.name}
                  </Link>
                </Button>
              ))}
            </nav>
          )
        }
      />
      <form className="mb-4 flex flex-wrap gap-2" role="search" aria-label="Filter cards">
        <Input name="q" defaultValue={filter.q} placeholder="Filter cards" className="max-w-xs" aria-label="Filter cards" />
        <select name="assignee" defaultValue={filter.assignee ?? ""} aria-label="Assignee" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
          <option value="">Everyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
        </select>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      <Board boardKey={board.key} columns={JSON.parse(JSON.stringify(board.columns))} priorities={priorities} />
    </>
  );
}
