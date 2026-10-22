/** @mentions are stored in rich text as <span data-type="mention" data-id="userId">. */
export function extractMentionIds(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(/<span[^>]*data-type="mention"[^>]*>/g)) {
    const id = m[0].match(/data-id="([^"]+)"/)?.[1];
    if (id) ids.add(id);
  }
  return [...ids];
}
