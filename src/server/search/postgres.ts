import type { Actor } from "@/core/rbac/actor";
import { can } from "@/core/rbac/actor";
import { canSeeInternal } from "@/core/tickets/access";
import { db } from "../db";
import { ticketVisibilityWhere } from "../services/ticket-access";
import type { ArticleHit, SearchProvider, TicketHit } from "./index";

const STOPWORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "for", "from", "has", "have", "how", "i", "if", "in", "is", "it", "keeps", "me", "my", "no", "not", "of", "on", "or", "our", "so", "that", "the", "this", "to", "up", "was", "we", "what", "when", "why", "with", "you", "your"]);

/**
 * Build a safe prefix tsquery from free text: "vpn conn" → 'vpn:* & conn:*'.
 * mode "any" ORs the words (used for suggestions, where ranking does the work).
 */
export function toPrefixQuery(input: string, mode: "all" | "any" = "all"): string | null {
  let tokens = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
  if (mode === "any") tokens = tokens.filter((t) => t.length > 2 && !STOPWORDS.has(t));
  tokens = [...new Set(tokens)].slice(0, 12);
  if (!tokens.length) return null;
  return tokens.map((t) => `${t}:*`).join(mode === "any" ? " | " : " & ");
}

/** ts_headline output uses «» markers which the UI turns into <mark>. */
const HEADLINE = "StartSel=«,StopSel=»,MaxWords=30,MinWords=12,MaxFragments=1";

export class PostgresSearchProvider implements SearchProvider {
  async searchTickets(actor: Actor, query: string, limit = 25): Promise<TicketHit[]> {
    const tsq = toPrefixQuery(query);
    if (!tsq) return [];
    const includeInternal = canSeeInternal(actor);
    const rows = await db.$queryRaw<{ id: string; rank: number; snippet: string; matched: "ticket" | "comment" }[]>`
      WITH q AS (SELECT to_tsquery('english', ${tsq}) AS q)
      SELECT * FROM (
        SELECT t.id, ts_rank(t.search_vector, q.q) * 1.0 AS rank,
               ts_headline('english', t.title || ' — ' || left(t.description_text, 2000), q.q, ${HEADLINE}) AS snippet,
               'ticket' AS matched
          FROM tickets t, q
         WHERE t.deleted_at IS NULL AND t.search_vector @@ q.q
        UNION ALL
        SELECT c.ticket_id AS id, ts_rank(c.search_vector, q.q) * 0.7 AS rank,
               ts_headline('english', left(c.body_text, 2000), q.q, ${HEADLINE}) AS snippet,
               'comment' AS matched
          FROM comments c, q
         WHERE c.deleted_at IS NULL AND c.search_vector @@ q.q
           AND (c.visibility = 'PUBLIC' OR ${includeInternal})
      ) hits
      ORDER BY rank DESC
      LIMIT 500`;

    // Exact ticket number match ranks first.
    const numberMatch = /^[A-Za-z]{2,6}\d{1,12}$/.test(query.trim())
      ? await db.ticket.findFirst({ where: { number: query.trim().toUpperCase(), deletedAt: null }, select: { id: true } })
      : null;

    const best = new Map<string, { rank: number; snippet: string; matched: "ticket" | "comment" }>();
    if (numberMatch) best.set(numberMatch.id, { rank: 100, snippet: "", matched: "ticket" });
    for (const r of rows) {
      const cur = best.get(r.id);
      if (!cur || r.rank > cur.rank) best.set(r.id, { rank: Number(r.rank), snippet: r.snippet, matched: r.matched });
    }
    if (!best.size) return [];

    const visible = await db.ticket.findMany({
      where: { AND: [{ id: { in: [...best.keys()] }, deletedAt: null }, ticketVisibilityWhere(actor)] },
      select: { id: true, number: true, title: true, status: true },
    });
    return visible
      .map((t) => ({ ...t, ...best.get(t.id)! }))
      .map((t) => ({ id: t.id, number: t.number, title: t.title, status: t.status, snippet: t.snippet, rank: t.rank, matchedIn: t.matched }))
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit);
  }

  async searchArticles(actor: Actor | null, query: string, limit = 10, mode: "all" | "any" = "all"): Promise<ArticleHit[]> {
    const tsq = toPrefixQuery(query, mode);
    if (!tsq) return [];
    const internal = actor ? can(actor, "kb.view_internal") : false;
    const rows = await db.$queryRaw<{ id: string; slug: string; title: string; rank: number; snippet: string; visibility: "PUBLIC" | "INTERNAL" }[]>`
      WITH q AS (SELECT to_tsquery('english', ${tsq}) AS q)
      SELECT a.id, a.slug, a.title, a.visibility::text AS visibility, ts_rank(a.search_vector, q.q) AS rank,
             ts_headline('english', coalesce(a.excerpt, '') || ' ' || left(a.body_text, 3000), q.q, ${HEADLINE}) AS snippet
        FROM knowledge_articles a, q
       WHERE a.deleted_at IS NULL AND a.status = 'PUBLISHED' AND a.search_vector @@ q.q
         AND (a.visibility = 'PUBLIC' OR ${internal})
       ORDER BY rank DESC
       LIMIT ${limit}`;
    return rows.map((r) => ({ ...r, rank: Number(r.rank) }));
  }
}
