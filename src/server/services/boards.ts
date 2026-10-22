/**
 * Agile boards: a Kanban view over tickets of the configured types. Moving a
 * card to another column performs a normal workflow transition (to the
 * column's first state), so workflow rules and permissions still apply.
 * WIP limits are shown, not enforced.
 */
import { z } from "zod";
import { getConfig } from "@/core/config/loader";
import { columnIndexForStatus, needsRebalance, rankBetween, type BoardConfig } from "@/core/boards/board";
import { NotFoundError, ValidationError } from "@/core/errors";
import { assertCan, assertCanAny, type Actor } from "@/core/rbac/actor";
import { db } from "../db";
import { ticketVisibilityWhere } from "./ticket-access";

export function boardsEnabled(): boolean {
  return getConfig().features.agileBoards;
}

export function listBoards(actor: Actor): BoardConfig[] {
  assertCanAny(actor, ["ticket.view_team", "ticket.view_all"]);
  return boardsEnabled() ? getConfig().boards : [];
}

function boardOrThrow(key: string): BoardConfig {
  const b = boardsEnabled() ? getConfig().boards.find((x) => x.key === key) : undefined;
  if (!b) throw new NotFoundError("Board");
  return b;
}

export const boardFilterSchema = z.object({ assignee: z.string().max(64).optional(), q: z.string().trim().max(200).optional() });

export async function getBoard(actor: Actor, key: string, filter: z.infer<typeof boardFilterSchema> = {}) {
  assertCanAny(actor, ["ticket.view_team", "ticket.view_all"]);
  const board = boardOrThrow(key);
  const cfg = getConfig();
  const team = board.team ? await db.team.findUnique({ where: { key: board.team }, select: { id: true, name: true } }) : null;
  const doneStates = new Set(cfg.ticketTypes.flatMap((t) => t.workflow.states.filter((s) => s.category === "resolved" || s.category === "closed").map((s) => s.key)));
  const allStates = board.columns.flatMap((c) => c.states);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const tickets = await db.ticket.findMany({
    where: {
      AND: [
        ticketVisibilityWhere(actor),
        { deletedAt: null, mergedIntoId: null, type: { key: { in: board.ticketTypes } }, status: { in: allStates } },
        team ? { teamId: team.id } : {},
        filter.assignee === "me" ? { assigneeId: actor.kind === "user" ? actor.id : "-" } : filter.assignee === "none" ? { assigneeId: null } : filter.assignee ? { assigneeId: filter.assignee } : {},
        filter.q ? { OR: [{ title: { contains: filter.q, mode: "insensitive" } }, { number: { contains: filter.q, mode: "insensitive" } }] } : {},
        // Finished work drops off the board after 30 days.
        { OR: [{ status: { notIn: [...doneStates] } }, { updatedAt: { gte: since } }] },
      ],
    },
    select: {
      id: true, number: true, title: true, status: true, priority: true, boardRank: true, dueAt: true, createdAt: true,
      assignee: { select: { id: true, name: true } },
      tags: { select: { tag: { select: { name: true } } } },
      type: { select: { key: true, name: true } },
    },
    orderBy: [{ boardRank: "asc" }, { createdAt: "asc" }],
    take: 1000,
  });
  const columns = board.columns.map((c) => ({ name: c.name, states: c.states, wipLimit: c.wipLimit ?? null, cards: [] as typeof tickets }));
  for (const t of tickets) columns[columnIndexForStatus(board, t.status)]?.cards.push(t);
  return { key: board.key, name: board.name, team, columns };
}

export const moveSchema = z.object({
  ticketId: z.string().min(1).max(64),
  column: z.number().int().min(0).max(50),
  /** Card directly above the drop position (null = top). */
  afterId: z.string().max(64).nullable().optional(),
  /** Card directly below the drop position (null = bottom). */
  beforeId: z.string().max(64).nullable().optional(),
});

export async function moveCard(actor: Actor, key: string, input: z.infer<typeof moveSchema>) {
  assertCan(actor, "ticket.update");
  const board = boardOrThrow(key);
  const col = board.columns[input.column];
  if (!col) throw new ValidationError("Unknown column");
  const ticket = await db.ticket.findFirst({ where: { AND: [{ id: input.ticketId, deletedAt: null, type: { key: { in: board.ticketTypes } } }, ticketVisibilityWhere(actor)] }, select: { id: true, status: true } });
  if (!ticket) throw new NotFoundError("Ticket");

  let status = ticket.status;
  if (!col.states.includes(ticket.status)) {
    const { transitionTicket } = await import("./tickets");
    status = (await transitionTicket(actor, ticket.id, { to: col.states[0]! })).status;
  }

  const neighbours = await db.ticket.findMany({ where: { id: { in: [input.afterId, input.beforeId].filter((x): x is string => Boolean(x)) } }, select: { id: true, boardRank: true } });
  const prev = neighbours.find((n) => n.id === input.afterId)?.boardRank;
  const next = neighbours.find((n) => n.id === input.beforeId)?.boardRank;
  if (needsRebalance(prev, next)) await rebalance(board, input.column);
  const fresh = needsRebalance(prev, next) ? await db.ticket.findMany({ where: { id: { in: neighbours.map((n) => n.id) } }, select: { id: true, boardRank: true } }) : neighbours;
  const rank = rankBetween(fresh.find((n) => n.id === input.afterId)?.boardRank, fresh.find((n) => n.id === input.beforeId)?.boardRank);
  // Rank is a display detail: don't bump updatedAt (it drives SLAs, sorting and automations).
  await db.$executeRaw`UPDATE tickets SET board_rank = ${rank} WHERE id = ${ticket.id}`;
  return { id: ticket.id, status, rank };
}

async function rebalance(board: BoardConfig, column: number) {
  const states = board.columns[column]!.states;
  const rows = await db.ticket.findMany({ where: { status: { in: states }, type: { key: { in: board.ticketTypes } }, deletedAt: null }, orderBy: [{ boardRank: "asc" }, { createdAt: "asc" }], select: { id: true } });
  for (const [i, r] of rows.entries()) await db.$executeRaw`UPDATE tickets SET board_rank = ${(i + 1) * 1024} WHERE id = ${r.id}`;
}
