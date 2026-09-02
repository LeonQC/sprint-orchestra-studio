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
 * "Exact only": keep the hits whose text literally contains what was typed, dropping the ones that
 * only matched after stemming ("orders" → "order") or typo-correction (fuzzy). A filter over the
 * already-ranked list, never a re-query, so toggling it can't reorder what's on screen.
 *
 * A row with `exactMatch` absent is KEPT. That's the older-backend case, and silently hiding real
 * results is a far worse failure than showing one loose match.
 *
 * Note this is only applied to backend hits: the local quick-jump list is literal by construction
 * (`scoreMatch` only ever uses ===/startsWith/includes), so the filter would be a no-op there.
 */
export function applyExactFilter(hits: SearchResultDto[], exactOnly: boolean): SearchResultDto[] {
  if (!exactOnly) return hits;
  return hits.filter((h) => h.exactMatch !== false);
}

/**
 * Stable, UNIQUE identity for a backend hit — its React `key` and the handle used to find its index
 * for keyboard navigation.
 *
 * This must not be derived from `issueId` alone. One issue can contribute several comment hits, so
 * `COMMENT-<issueId>` collides. Duplicate keys are not merely a console warning here: when React
 * reconciles a shrinking list it maps the surviving children by key, and duplicates overwrite each
 * other in that map — so the colliding fibers are never scheduled for deletion and their DOM nodes
 * survive. That is exactly how ticking "Exact only" appeared to leave non-exact rows on screen: the
 * filter was correct, the rows were stale renders of the pre-filter list.
 *
 * `resultId` is the underlying row id (issue id / comment id). Falls back to a positional key for an
 * older backend that doesn't send it — still unique, just not stable across reorders.
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
