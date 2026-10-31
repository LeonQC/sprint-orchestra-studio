import type { SearchResultDto } from '../api/searchApi';
import type { Ticket } from '../types/ticket';

/**
 * Pure logic behind the top-bar quick search, extracted from `IssueQuickSearch.tsx` so it can be
 * unit-tested (the test runner only covers plain `.ts` modules, never `.tsx`).
 */

/** First paint size. */
export const INITIAL_VISIBLE = 8;
/** How many extra rows each "Show more" click adds. */
export const PAGE_SIZE = 10;
/**
 * DOM-safety ceiling, NOT a result limit: a space with thousands of issues shouldn't build
 * thousands of nodes in a dropdown. Every match below this is reachable by paging — the previous
 * `HARD_CAP = 10` claimed to be this but silently made matches 11+ unreachable, which is how a
 * search for "heckout" could report "5 more match" and offer no way to see them.
 */
export const MAX_RENDERED = 200;

/**
 * Rank matches: issue-key hit first, then title-start, then any substring. Lower score = better.
 * Returns null when the ticket doesn't match at all.
 */
export function scoreMatch(ticket: Ticket, q: string): number | null {
  const key = ticket.id.toLowerCase();
  const title = ticket.title.toLowerCase();
  const assignee = (ticket.assignee ?? '').toLowerCase();
  if (key === q) return 0;
  if (key.startsWith(q)) return 1;
  if (key.includes(q)) return 2;
  if (title.startsWith(q)) return 3;
  if (title.includes(q)) return 4;
  if (assignee.includes(q)) return 5;
  return null;
}

function createdAtMs(t: Ticket): number {
  if (!t.createdAt) return 0;
  const ms = Date.parse(t.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

/** All local (current-space) tickets matching `query`, best match first then newest first. */
export function rankLocalMatches(tickets: Ticket[], query: string): Ticket[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return tickets
    .map((t) => ({ t, score: scoreMatch(t, q) }))
    .filter((r): r is { t: Ticket; score: number } => r.score !== null)
    .sort((a, b) => {
      // 1) Better match quality first
      if (a.score !== b.score) return a.score - b.score;
      // 2) Same quality → newest first (Jira-like recency)
      const byTime = createdAtMs(b.t) - createdAtMs(a.t);
      if (byTime !== 0) return byTime;
      // 3) Stable fallback
      return a.t.id.localeCompare(b.t.id);
    })
    .map((r) => r.t);
}

export interface VisibleSlice<T> {
  /** Rows to render right now. */
  rows: T[];
  /** Everything paging can still reach (i.e. capped only by MAX_RENDERED). */
  reachable: number;
  /** Total matches found, including any beyond MAX_RENDERED. */
  total: number;
  /** True when a "Show more" click would reveal further rows. */
  canShowMore: boolean;
  /** How many more rows the next "Show more" click adds. */
  nextBatch: number;
  /** Matches that even paging cannot reach — only a narrower query will. */
  beyondCap: number;
}

/** Slice a ranked list for display, keeping every count honest. */
export function visibleSlice<T>(ranked: T[], visibleCount: number): VisibleSlice<T> {
  const pool = ranked.slice(0, MAX_RENDERED);
  const rows = pool.slice(0, Math.max(0, visibleCount));
  return {
    rows,
    reachable: pool.length,
    total: ranked.length,
    canShowMore: rows.length < pool.length,
    nextBatch: Math.min(PAGE_SIZE, pool.length - rows.length),
    beyondCap: Math.max(0, ranked.length - MAX_RENDERED),
  };
}

/**
 * Human labels for `SearchResultDto.matchedFields`. The backend emits a fixed vocabulary (see
 * SearchService/IssueRepository); anything unrecognized is passed through rather than dropped, so a
 * newer backend adding a field still renders something meaningful against an older bundle.
 */
const FIELD_LABELS: Record<string, string> = {
  key: 'issue key',
  title: 'title',
  description: 'description',
  labels: 'label',
  attachment: 'attachment name',
  comment: 'comment',
};

export function matchedFieldLabels(fields: string[] | undefined): string[] {
  if (!fields || fields.length === 0) return [];
  return fields.map((f) => FIELD_LABELS[f] ?? f);
}

/**
 * "Exact only": keep hits that literally contain the query, dropping stemmed or fuzzy matches. Filters
 * the ranked list (never re-queries), so order doesn't change. Rows without `exactMatch` (older
 * backend) are kept. Local quick-jump results are already literal, so this only applies to backend hits.
 */
export function applyExactFilter(hits: SearchResultDto[], exactOnly: boolean): SearchResultDto[] {
  if (!exactOnly) return hits;
  return hits.filter((h) => h.exactMatch !== false);
}

/**
 * Backend hits minus the ones the quick-jump list above already shows, so one issue never occupies
 * two rows of the same dropdown. Issue hits only: a comment hit is never in that list, even when
 * its issue is.
 */
export function dedupeAgainstLocal(
  hits: SearchResultDto[],
  localIds: Set<string>,
): SearchResultDto[] {
  return hits.filter((h) => !(h.type === 'ISSUE' && localIds.has(h.issueKey)));
}

/**
 * Empty-state text for the "Elsewhere" section, which answers one question: is there anything beyond
 * the quick-jump list above?
 *
 * Exactness is counted on the list BEFORE deduping: the deduped rows are exactly the likely exact
 * matches, so counting after deduping wrongly said "No exact matches" (seen with "search recent
 * orders", whose one exact hit, ATC-64, had moved up). The wording talks about the rest of the corpus
 * ("Nothing else"), so nobody is sent back up to re-read a row.
 */
export function remoteEmptyMessage(
  remoteResults: SearchResultDto[],
  localIds: Set<string>,
  exactOnly: boolean,
  query: string,
): string {
  const q = query.trim();
  if (!exactOnly) return `No full-text matches for “${q}”.`;

  const nearMatches = dedupeAgainstLocal(remoteResults, localIds).length;
  const exactAbove = remoteResults.some(
    (h) => h.type === 'ISSUE' && localIds.has(h.issueKey) && h.exactMatch !== false,
  );

  const hidden =
    nearMatches === 0
      ? ''
      : nearMatches === 1
        ? ' 1 near match hidden — uncheck “Exact only” to see it.'
        : ` ${nearMatches} near matches hidden — uncheck “Exact only” to see them.`;

  if (exactAbove) {
    return `Nothing else matches “${q}” exactly.${hidden}`;
  }
  if (nearMatches === 0) {
    return `No full-text matches for “${q}”.`;
  }
  return `No exact matches for “${q}”.${hidden}`;
}

/**
 * Unique, stable key for a backend hit (React `key` and keyboard-navigation handle).
 *
 * Not `issueId` alone: one issue can have several comment hits, and duplicate keys made React keep
 * stale rows on screen after "Exact only" filtered them out. Uses `resultId` (row id); falls back to a
 * positional key for older backends.
 */
export function hitKey(hit: SearchResultDto, index: number): string {
  return hit.resultId != null ? `${hit.type}-${hit.resultId}` : `${hit.type}-${hit.issueKey}-i${index}`;
}

/**
 * The snippet to render for a hit. Under "Exact only" prefer `exactSnippet`, which is built around
 * the literal occurrence, so the highlighted text is always what the user actually typed — the
 * default `snippet` comes from ts_headline and highlights the matched stem ("payment" for a search
 * on "payments"), which reads as a broken filter even when the row is a genuine exact hit.
 */
export function snippetFor(hit: SearchResultDto, exactOnly: boolean): string {
  if (exactOnly && hit.exactSnippet) return hit.exactSnippet;
  return hit.snippet;
}
