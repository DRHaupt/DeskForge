/**
 * Search abstraction. The default provider uses PostgreSQL full-text search;
 * implement SearchProvider (e.g. with Meilisearch) and return it from
 * getSearchProvider() to swap engines without touching callers.
 */
import type { Actor } from "@/core/rbac/actor";
import { PostgresSearchProvider } from "./postgres";

export type TicketHit = { id: string; number: string; title: string; status: string; snippet: string; rank: number; matchedIn: "ticket" | "comment" };
export type ArticleHit = { id: string; slug: string; title: string; snippet: string; rank: number; visibility: "PUBLIC" | "INTERNAL" };

export interface SearchProvider {
  searchTickets(actor: Actor, query: string, limit?: number): Promise<TicketHit[]>;
  searchArticles(actor: Actor | null, query: string, limit?: number): Promise<ArticleHit[]>;
}

let provider: SearchProvider | undefined;

export function getSearchProvider(): SearchProvider {
  provider ??= new PostgresSearchProvider();
  return provider;
}
