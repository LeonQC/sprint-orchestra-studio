import assert from 'node:assert/strict';
import test from 'node:test';
import type { SearchResultDto } from '../src/api/searchApi.ts';
import type { Ticket } from '../src/types/ticket.ts';
import {
  INITIAL_VISIBLE,
  MAX_RENDERED,
  PAGE_SIZE,
  applyExactFilter,
  dedupeAgainstLocal,
  hitKey,
  matchedFieldLabels,
  rankLocalMatches,
  remoteEmptyMessage,
  scoreMatch,
  snippetFor,
  visibleSlice,
} from '../src/components/quickSearchUtils.ts';

function ticket(id: string, title: string, createdAt?: string, assignee?: string): Ticket {
  return { id, title, status: 'planned', createdAt, assignee } as Ticket;
}

/**
 * The exact reported regression: searching "heckout" in the AtlasCart space matched 15 issues, the
 * dropdown rendered 10 and said "5 more match" with no way to reach them. ATC-3 is the oldest of
 * the 15, so the recency tiebreak puts it last — it was the invisible one.
 */
const HECKOUT_MATCHES: Ticket[] = [
  ticket('ATC-454', "[ai-demo] Show prices in the shopper's local currency at checkout", '2026-08-20'),
  ticket('ATC-453', '[ai-demo] Add multi-currency price display to checkout', '2026-08-19'),
  ticket('ATC-82', 'Fix checkout focus after validation errors', '2026-07-10'),
  ticket('ATC-80', 'Load-test catalog through checkout', '2026-07-09'),
  ticket('ATC-62', 'Choose a shipping option at checkout', '2026-06-20'),
  ticket('ATC-48', 'Checkout accepts more items than current stock', '2026-06-10'),
  ticket('ATC-47', 'Cover slow checkout in regression tests', '2026-06-09'),
  ticket('ATC-45', 'Disable Place order while checkout is pending', '2026-06-08'),
  ticket('ATC-44', 'Reject repeated checkout requests', '2026-06-07'),
  ticket('ATC-43', 'Checkout can create two orders from a double click', '2026-06-06'),
  ticket('ATC-35', 'Run the checkout test plan', '2026-05-20'),
  ticket('ATC-33', 'Add request IDs to checkout logs', '2026-05-19'),
  ticket('ATC-30', 'Create one order from checkout', '2026-05-18'),
  ticket('ATC-27', 'Check stock before checkout', '2026-05-17'),
  ticket('ATC-3', 'Let shoppers complete checkout', '2026-01-02'),
];

test('regression: every "heckout" match is reachable by paging, including the oldest (ATC-3)', () => {
  const ranked = rankLocalMatches(HECKOUT_MATCHES, 'heckout');
  assert.equal(ranked.length, 15, 'all 15 substring matches must rank');
  assert.ok(ranked.some((t) => t.id === 'ATC-3'), 'ATC-3 must be in the ranked list');

  // Page until "Show more" is exhausted — every match must become visible.
  let visible = INITIAL_VISIBLE;
  let slice = visibleSlice(ranked, visible);
  let clicks = 0;
  while (slice.canShowMore && clicks < 50) {
    visible += PAGE_SIZE;
    slice = visibleSlice(ranked, visible);
    clicks += 1;
  }
  assert.equal(slice.rows.length, 15, 'paging must reach all 15');
  assert.equal(slice.beyondCap, 0, 'nothing may be stranded beyond the render cap');
  assert.ok(slice.rows.some((t) => t.id === 'ATC-3'), 'ATC-3 must be reachable');
});

test('first paint shows a page, and counts describe the whole match set honestly', () => {
  const ranked = rankLocalMatches(HECKOUT_MATCHES, 'heckout');
  const slice = visibleSlice(ranked, INITIAL_VISIBLE);
  assert.equal(slice.rows.length, INITIAL_VISIBLE);
  assert.equal(slice.total, 15, 'total is the real match count, not a capped one');
  assert.equal(slice.reachable, 15);
  assert.equal(slice.canShowMore, true);
  assert.equal(slice.nextBatch, 7, 'next click reveals the remaining 7');
});

test('ranks issue-key hits above title hits, and title-start above title-substring', () => {
  const tickets = [
    ticket('ATC-100', 'Unrelated work'),
    ticket('ATC-9', 'Checkout timing'),          // title starts with the query
    ticket('ATC-8', 'Fix the checkout page'),    // title contains the query
    ticket('CHECKOUT-1', 'Something else'),      // key contains the query
  ];
  const ranked = rankLocalMatches(tickets, 'checkout').map((t) => t.id);
  assert.deepEqual(ranked, ['CHECKOUT-1', 'ATC-9', 'ATC-8']);
});

test('exact key beats prefix key', () => {
  const tickets = [ticket('ATC-4', 'a'), ticket('ATC-40', 'b'), ticket('ATC-41', 'c')];
  const ranked = rankLocalMatches(tickets, 'atc-4').map((t) => t.id);
  assert.equal(ranked[0], 'ATC-4');
  assert.equal(ranked.length, 3);
});

test('scoreMatch returns null for a non-match and matches on assignee last', () => {
  assert.equal(scoreMatch(ticket('ATC-1', 'Nothing here'), 'zzz'), null);
  assert.equal(scoreMatch(ticket('ATC-1', 'Nothing here', undefined, 'maya'), 'maya'), 5);
});

test('an empty query matches nothing', () => {
  assert.deepEqual(rankLocalMatches(HECKOUT_MATCHES, '   '), []);
});

test('the render cap bounds the DOM but is reported, never silently dropped', () => {
  const many = Array.from({ length: MAX_RENDERED + 25 }, (_, i) =>
    ticket(`ATC-${i + 1}`, `checkout item ${i + 1}`, '2026-01-01'),
  );
  const ranked = rankLocalMatches(many, 'checkout');
  const slice = visibleSlice(ranked, MAX_RENDERED);
  assert.equal(slice.total, MAX_RENDERED + 25, 'total reports every match');
  assert.equal(slice.reachable, MAX_RENDERED);
  assert.equal(slice.beyondCap, 25, 'the overflow is surfaced so the UI can say "narrow your query"');
  assert.equal(slice.canShowMore, false);
});

test('maps backend match-field names to human labels', () => {
  assert.deepEqual(matchedFieldLabels(['title', 'labels']), ['title', 'label']);
  assert.deepEqual(matchedFieldLabels(['attachment']), ['attachment name']);
  assert.deepEqual(matchedFieldLabels(['key']), ['issue key']);
  assert.deepEqual(matchedFieldLabels(['comment']), ['comment']);
});

test('matched-field labels tolerate an absent or unknown value from an older/newer backend', () => {
  assert.deepEqual(matchedFieldLabels(undefined), []);
  assert.deepEqual(matchedFieldLabels([]), []);
  assert.deepEqual(matchedFieldLabels(['worklog']), ['worklog'], 'unknown field passes through');
});

// --- "Exact only" filter -------------------------------------------------------------------------

function hit(issueKey: string, exactMatch?: boolean): SearchResultDto {
  return {
    type: 'ISSUE', matchType: 'FULL_TEXT', spaceId: 1, issueId: 1,
    issueKey, title: 't', snippet: '', rank: 1, exactMatch, updatedAt: '2026-01-01',
  } as SearchResultDto;
}

function commentHit(issueKey: string, issueId: number, resultId?: number): SearchResultDto {
  return {
    type: 'COMMENT', resultId, matchType: 'FULL_TEXT', spaceId: 1, issueId,
    issueKey, title: 't', snippet: '', rank: 1, exactMatch: false, updatedAt: '2026-01-01',
  } as SearchResultDto;
}

test('exact filter drops stemmed/fuzzy hits and keeps literal ones', () => {
  const hits = [hit('ATC-1', true), hit('ATC-2', false), hit('ATC-3', true)];
  assert.deepEqual(
    applyExactFilter(hits, true).map((h) => h.issueKey),
    ['ATC-1', 'ATC-3'],
  );
});

test('exact filter is a no-op when the toggle is off', () => {
  const hits = [hit('ATC-1', true), hit('ATC-2', false)];
  assert.deepEqual(applyExactFilter(hits, false), hits, 'same array contents, original order');
});

test('exact filter never reorders what survives', () => {
  const hits = [hit('ATC-9', true), hit('ATC-2', false), hit('ATC-5', true), hit('ATC-1', true)];
  assert.deepEqual(
    applyExactFilter(hits, true).map((h) => h.issueKey),
    ['ATC-9', 'ATC-5', 'ATC-1'],
    'ranking order is preserved — filtering must not reshuffle the list',
  );
});

test('a hit from an older backend (no exactMatch field) is kept, never silently hidden', () => {
  const hits = [hit('ATC-1', undefined), hit('ATC-2', false)];
  assert.deepEqual(
    applyExactFilter(hits, true).map((h) => h.issueKey),
    ['ATC-1'],
    'absent means unknown; hiding real results is worse than showing one loose match',
  );
});

// --- Row identity ---------------------------------------------------------------------------------

/**
 * The reported regression: searching "payments" with "Exact only" ticked still showed ATC-32 three
 * times and ATC-30 twice. The filter was right — those rows really were exactMatch:false — but every
 * row was keyed `COMMENT-${issueId}`, and ATC-32/ATC-30 each contributed several comment hits. React
 * maps surviving children by key when a list shrinks, duplicates overwrite one another in that map,
 * and the colliding fibers are then never deleted; their DOM nodes stay on screen.
 *
 * The real-world shape, from `GET /api/search?q=payments`: 32 rows, only 29 distinct issue ids.
 */
const PAYMENT_COMMENT_HITS: SearchResultDto[] = [
  commentHit('ATC-32', 5001276, 5004462),
  commentHit('ATC-32', 5001276, 5004561),
  commentHit('ATC-30', 5001274, 5004550),
  commentHit('ATC-32', 5001276, 5004502),
  commentHit('ATC-30', 5001274, 5004454),
];

test('regression: several comment hits on one issue get distinct keys', () => {
  const keys = PAYMENT_COMMENT_HITS.map(hitKey);
  assert.equal(new Set(keys).size, PAYMENT_COMMENT_HITS.length, 'duplicate React keys strand rows in the DOM');
});

test('an issue hit and a comment hit on the same issue never collide', () => {
  const issueHit = { ...hit('ATC-32', true), resultId: 5001276, issueId: 5001276 } as SearchResultDto;
  assert.notEqual(hitKey(issueHit, 0), hitKey(commentHit('ATC-32', 5001276, 5001276), 1));
});

test('keys stay unique without resultId (older backend), falling back to position', () => {
  const legacy = PAYMENT_COMMENT_HITS.map((h) => ({ ...h, resultId: undefined }));
  const keys = legacy.map(hitKey);
  assert.equal(new Set(keys).size, legacy.length);
});

// --- Snippet selection ----------------------------------------------------------------------------

test('under "Exact only" the literal snippet wins, so the highlight is what was typed', () => {
  const h = {
    ...hit('ATC-80', true),
    snippet: 'protecting the <b>payment</b> sandbox',        // the highlighter marks the STEM
    exactSnippet: '…and fixture <b>payments</b>.',            // literal occurrence
  } as SearchResultDto;
  assert.equal(snippetFor(h, true), '…and fixture <b>payments</b>.');
  assert.equal(snippetFor(h, false), 'protecting the <b>payment</b> sandbox');
});

test('snippet falls back when the backend sends no exactSnippet', () => {
  const h = { ...hit('ATC-1', true), snippet: 'plain', exactSnippet: null } as SearchResultDto;
  assert.equal(snippetFor(h, true), 'plain');
  const older = { ...hit('ATC-1', true), snippet: 'plain' } as SearchResultDto;
  assert.equal(snippetFor(older, true), 'plain');
});

// --- Dedupe against the quick-jump list, and the empty state it can produce ------------------------

test('dedupe removes only the issue rows the quick-jump list above already shows', () => {
  const remote = [hit('ATC-64', true), commentHit('ATC-64', 5003203, 5005313), hit('ATC-32', false)];
  assert.deepEqual(
    dedupeAgainstLocal(remote, new Set(['ATC-64'])).map(hitKey),
    ['COMMENT-5005313', 'ISSUE-ATC-32-i1'],
    'the comment on ATC-64 survives: it is not a row of the quick-jump list',
  );
});

/**
 * The reported bug. Searching "search recent orders" in AtlasCart, the backend returned exactly one
 * exactMatch:true row — ATC-64 "Search recent orders by reference" — and because the current space
 * owns ATC-64, the dedupe moved it into the quick-jump list. Ticking "Exact only" then emptied this
 * section and explained it with "No exact matches for ...", which was false: the exact match was two
 * rows higher on the same screen.
 */
test('regression: the empty state never denies an exact match the dedupe moved upward', () => {
  const remote = [hit('ATC-64', true), commentHit('ATC-64', 5003203, 5005313), hit('ATC-32', false)];
  const message = remoteEmptyMessage(remote, new Set(['ATC-64']), true, 'search recent orders');

  assert.doesNotMatch(message, /No exact matches/, 'there IS one — it is just rendered above');
  assert.equal(
    message,
    'Nothing else matches “search recent orders” exactly.'
      + ' 2 near matches hidden — uncheck “Exact only” to see them.',
  );
});

test('with no exact hit anywhere, the empty state still says so', () => {
  const remote = [hit('ATC-32', false), hit('ATC-44', false)];
  assert.equal(
    remoteEmptyMessage(remote, new Set(), true, 'recnt ordrs'),
    'No exact matches for “recnt ordrs”. 2 near matches hidden'
      + ' — uncheck “Exact only” to see them.',
  );
});

test('singular phrasing when exactly one near match is hidden', () => {
  assert.equal(
    remoteEmptyMessage([hit('ATC-32', false)], new Set(), true, 'ordrs'),
    'No exact matches for “ordrs”. 1 near match hidden — uncheck “Exact only” to see it.',
  );
});

test('several exact hits deduped upward still read as one statement about the rest', () => {
  const remote = [hit('ATC-64', true), hit('ATC-32', true)];
  assert.equal(
    remoteEmptyMessage(remote, new Set(['ATC-64', 'ATC-32']), true, 'orders'),
    'Nothing else matches “orders” exactly.',
    'nothing is left in this section to hide, so no near-match clause',
  );
});

/**
 * The section is headed "Elsewhere", so its empty state must speak about the rest of the corpus.
 * A sentence about "this space" makes the reader climb back up the dropdown to do the merging the
 * UI should have done for them.
 */
test('the empty state answers the question its own section header asks', () => {
  const remote = [hit('ATC-64', true), commentHit('ATC-64', 5003203, 5005313)];
  const message = remoteEmptyMessage(remote, new Set(['ATC-64']), true, 'search recent orders');
  assert.doesNotMatch(message, /this space/, 'the section is about every OTHER space');
  assert.doesNotMatch(message, /above/, 'do not send the reader hunting for a row they just read');
  assert.match(message, /^Nothing else matches/);
});

test('an exact hit deduped upward is still counted when the backend omits exactMatch', () => {
  const remote = [hit('ATC-64', undefined)];
  assert.match(
    remoteEmptyMessage(remote, new Set(['ATC-64']), true, 'orders'),
    /^Nothing else matches/,
    'absent means unknown; claiming "no exact matches" would be the same lie as before',
  );
});

test('with the toggle off, the empty state is about matches, not exactness', () => {
  assert.equal(
    remoteEmptyMessage([], new Set(), false, 'zzz'),
    'No full-text matches for “zzz”.',
  );
});

test('a query that matched nothing at all reads the same under "Exact only"', () => {
  assert.equal(
    remoteEmptyMessage([], new Set(), true, 'zzz'),
    'No full-text matches for “zzz”.',
    'no hits and no hidden rows — "no exact matches" would imply near ones exist',
  );
});
