/** Label selection in Create Issue, where the user and the "AI draft" button both write to one list.
 *
 *  Merging drafts into the selection never forgot old suggestions, so drafting three times lit up
 *  labels from every run; simply overwriting would drop labels the user had picked. So each label has
 *  an owner: labels from the last draft belong to the draft (the next draft may replace them); labels
 *  the user touched belong to the user (drafts never change them, see `toggleDraftLabel`). */

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
