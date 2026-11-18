/**
 * One matching policy for every search box in the console.
 *
 * Queries are case- and diacritic-insensitive, split on whitespace, and every
 * token must appear somewhere in the candidate text. That makes "prod billing"
 * match "billing · production" without each caller re-implementing the rules.
 */
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function searchTokens(query: string): string[] {
  return normalizeSearch(query).split(/\s+/).filter(Boolean);
}

/** `true` when every token in `query` appears in one of the haystack parts. */
export function matchesSearch(haystack: Array<string | undefined | null>, query: string): boolean {
  const tokens = searchTokens(query);
  if (!tokens.length) return true;
  const hay = normalizeSearch(haystack.filter((part): part is string => Boolean(part)).join(' '));
  return tokens.every((token) => hay.includes(token));
}

/**
 * Merge search candidates in priority order while dropping duplicate ids.
 * Useful when the same secret can arrive from recents, favorites and an index.
 */
export function uniqueBy<T>(items: T[], id: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = id(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
