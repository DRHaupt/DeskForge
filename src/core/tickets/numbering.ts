/** Human-readable ticket numbers: prefix + zero-padded counter, e.g. INC0001042. */

export function formatTicketNumber(prefix: string, n: number, padding = 7): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid ticket counter ${n}`);
  return `${prefix}${String(n).padStart(padding, "0")}`;
}

/**
 * Find ticket numbers in free text (e.g. an email subject "Re: [INC0001042] Printer").
 * Only returns numbers whose prefix is one of the known prefixes.
 */
export function findTicketNumbers(text: string, prefixes: string[]): string[] {
  if (!prefixes.length) return [];
  const escaped = prefixes.map((p) => p.replace(/[^A-Z]/g, "")).filter(Boolean);
  const re = new RegExp(`\\b(${escaped.join("|")})(\\d{3,12})\\b`, "g");
  const found = new Set<string>();
  for (const m of text.matchAll(re)) found.add(`${m[1]}${m[2]}`);
  return [...found];
}
