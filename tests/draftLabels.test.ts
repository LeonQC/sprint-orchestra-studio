import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyDraftLabels,
  EMPTY_DRAFT_LABEL_SELECTION,
  toggleDraftLabel,
  type DraftLabelSelection,
} from '../src/utils/draftLabels.ts';

/** Replay a sequence of modal interactions and return the labels the form would submit. */
function replay(
  steps: ReadonlyArray<{ draft: readonly string[] } | { toggle: string }>,
): string[] {
  let state: DraftLabelSelection = EMPTY_DRAFT_LABEL_SELECTION;
  for (const step of steps) {
    state = 'draft' in step
      ? applyDraftLabels(state, step.draft)
      : toggleDraftLabel(state, step.toggle);
  }
  return [...state.selected];
}

test('re-running the AI draft replaces its own labels instead of accumulating them', () => {
  // The reported bug: three drafts in one open modal lit every label all three runs had suggested.
  assert.deepEqual(
    replay([
      { draft: ['checkout', 'frontend'] },
      { draft: ['orders', 'performance'] },
      { draft: ['backend'] },
    ]),
    ['backend'],
  );
});

test('labels ticked by hand before drafting survive the draft', () => {
  // The bug a naive overwrite would introduce instead.
  assert.deepEqual(
    replay([
      { toggle: 'security' },
      { draft: ['checkout', 'orders'] },
    ]),
    ['security', 'checkout', 'orders'],
  );
});

test('hand-picked labels survive every later draft, not just the first', () => {
  assert.deepEqual(
    replay([
      { toggle: 'security' },
      { draft: ['checkout', 'orders'] },
      { draft: ['backend'] },
    ]),
    ['security', 'backend'],
  );
});

test('a draft label the user unticked is not silently reinstated', () => {
  assert.deepEqual(
    replay([
      { draft: ['checkout', 'orders'] },
      { toggle: 'orders' },
      { draft: ['checkout', 'frontend'] },
    ]),
    ['checkout', 'frontend'],
  );
});

test('once the user ticks a label it is theirs, even if a draft suggested it first', () => {
  assert.deepEqual(
    replay([
      { draft: ['checkout'] },
      { toggle: 'checkout' },   // untick — ownership moves to the user
      { toggle: 'checkout' },   // tick again, deliberately
      { draft: ['backend'] },
    ]),
    ['checkout', 'backend'],
  );
});

test('a draft that re-suggests a user-owned label cannot take ownership back', () => {
  // Subtle: 'checkout' is ticked by hand, then a draft also suggests it. If that draft were allowed
  // to claim it, the NEXT draft would clear a label the user had explicitly chosen.
  assert.deepEqual(
    replay([
      { toggle: 'checkout' },
      { draft: ['checkout', 'orders'] },
      { draft: ['backend'] },
    ]),
    ['checkout', 'backend'],
  );
});

test('a repeated label in one draft response is only selected once', () => {
  // `draftLabels` comes from a model, so a duplicate is possible and would render a doubled chip.
  assert.deepEqual(replay([{ draft: ['checkout', 'checkout', 'orders'] }]), ['checkout', 'orders']);
});

test('applying a draft never mutates the previous selection', () => {
  // The modal keeps this in React state; mutating in place would skip a re-render.
  const first = applyDraftLabels(EMPTY_DRAFT_LABEL_SELECTION, ['checkout']);
  const second = applyDraftLabels(first, ['orders']);

  assert.deepEqual([...first.selected], ['checkout']);
  assert.deepEqual([...second.selected], ['orders']);
  assert.notEqual(first, second);
});

test('an empty draft is applied as an empty draft, not ignored', () => {
  // Guard on the boundary between the modal and this module: the modal only calls applyDraftLabels
  // when `draft.labels.length > 0`, so an empty response leaves the previous selection alone. This
  // module itself must still behave sanely if that guard is ever removed — clearing the draft's own
  // labels and keeping the user's.
  const state = applyDraftLabels(
    toggleDraftLabel(applyDraftLabels(EMPTY_DRAFT_LABEL_SELECTION, ['checkout']), 'security'),
    [],
  );
  assert.deepEqual([...state.selected], ['security']);
});

test('toggling a label the draft never suggested leaves draft ownership intact', () => {
  const afterDraft = applyDraftLabels(EMPTY_DRAFT_LABEL_SELECTION, ['checkout', 'orders']);
  const afterToggle = toggleDraftLabel(afterDraft, 'security');

  assert.deepEqual([...afterToggle.ownedByDraft], ['checkout', 'orders']);
  assert.deepEqual([...applyDraftLabels(afterToggle, ['backend']).selected], ['security', 'backend']);
});
