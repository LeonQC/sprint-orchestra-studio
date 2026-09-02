import { api } from './client';

export interface SearchResultDto {
  type: 'ISSUE' | 'COMMENT';
  /** Identity of the underlying row — issue id for an ISSUE hit, COMMENT id for a comment hit.
   *  `type + resultId` is unique across a result set; `issueId` is not (one issue can contribute
   *  several comment hits). Optional so a rolling deploy against an older backend still parses. */
  resultId?: number;
  /** Which search tier produced this hit — exact issue-key, stemmed full-text, literal substring,
   *  or trigram fuzzy fallback. */
  matchType: 'EXACT_KEY' | 'FULL_TEXT' | 'SUBSTRING' | 'FUZZY';
  spaceId: number;
  issueId: number;
  issueKey: string;
  title: string;
  snippet: string;
  rank: number;
  /** Which field(s) the query matched — "key" | "title" | "description" | "labels" | "attachment"
   *  | "comment". `matchType` says which tier fired; this says why the row is a hit. Optional so a
   *  rolling deploy against an older backend still parses. */
  matchedFields?: string[];
  /** Whether the typed text appears verbatim in some field. False for a stemmed-only or
   *  typo-corrected (fuzzy) hit — what the "Exact only" filter drops. Optional so a rolling deploy
   *  against an older backend still parses (absent is treated as "don't hide it"). */
  exactMatch?: boolean;
  /** Snippet built around the LITERAL occurrence (same `<b>` markers as `snippet`), present exactly
   *  when `exactMatch` is true. Shown instead of `snippet` under "Exact only", because `snippet`
   *  comes from ts_headline and highlights the matched STEM — bolding "payment" for a search on
   *  "payments" makes a correct exact hit look like a broken filter. */
  exactSnippet?: string | null;
  updatedAt: string;
}

export const searchApi = {
  search: (q: string, limit = 20) =>
    api.get<SearchResultDto[]>(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),
};
