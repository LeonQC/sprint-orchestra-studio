/** Label selection in the Create Issue modal, where two sources write to the same list: the user
 *  ticking chips by hand, and the "AI draft" button applying a suggested set.
 *
 *  Modelled as a tiny state machine rather than a plain `string[]` because the two sources need
 *  different lifetimes, and conflating them is exactly what broke: the modal used to apply a draft
 *  with `new Set([...previous, ...draftLabels])`, a union that never forgets. Every other field the
 *  draft fills (title, issue type, estimate, dependencies) is overwritten on each run, so drafting
 *  two or three times in one open modal quietly accumulated the union of every label any run had
 *  ever suggested — the user saw four or five chips lit from three different attempts and had to
 *  untick the stale ones by hand.
 *
 *  Replacing the union with a plain overwrite would trade that for the opposite bug: labels the user
 *  ticked BEFORE pressing the button would vanish. So each label is tracked with an owner:
 *
 *    - a label the last draft contributed is the draft's, and the next draft may replace it
 *    - a label the user has touched is the user's, and no draft may add or remove it
 *
 *  Touching a label transfers ownership permanently (see `toggleDraftLabel`) — once someone has made
 *  a deliberate choice about a chip, an automated suggestion should not silently undo it.
 */

export type DraftLabelSelection = {
  /** Every label currently ticked, in the order it was added — what the form submits. */
  readonly selected: readonly string[];
  /** The subset of `selected` contributed by the most recent AI draft and not since touched by the
   *  user. Only these are cleared when the next draft is applied. */
  readonly ownedByDraft: readonly string[];
};

export const EMPTY_DRAFT_LABEL_SELECTION: DraftLabelSelection = { selected: [], ownedByDraft: [] };

/** Apply an AI draft's labels, replacing the previous draft's suggestions but keeping the user's. */
export function applyDraftLabels(
  current: DraftLabelSelection,
  draftLabels: readonly string[],
): DraftLabelSelection {
  // De-duplicate the incoming list too: it comes from a model, so a repeated label is possible and
  // would otherwise render the same chip twice.
  const incoming = Array.from(new Set(draftLabels));
  const userOwned = current.selected.filter((name) => !current.ownedByDraft.includes(name));
  return {
    selected: Array.from(new Set([...userOwned, ...incoming])),
    // A label the user already owns stays theirs even when this draft also suggests it, so a later
    // draft can't claim it back and clear it.
    ownedByDraft: incoming.filter((name) => !userOwned.includes(name)),
  };
}

/** Tick or untick a label by hand, transferring it out of the draft's ownership either way. */
export function toggleDraftLabel(current: DraftLabelSelection, name: string): DraftLabelSelection {
  const isSelected = current.selected.includes(name);
  return {
    selected: isSelected
      ? current.selected.filter((label) => label !== name)
      : [...current.selected, name],
    ownedByDraft: current.ownedByDraft.filter((label) => label !== name),
  };
}
