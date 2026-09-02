/** The AI draft's story-point suggestion in the Create Issue modal, and the rationale that explains
 *  it.
 *
 *  A number on its own is the part people don't trust — "why 5?" is the first question anyone asks
 *  in estimation, so ai-service returns `estimateRationale` alongside `estimateStoryPoints` (null
 *  exactly when the estimate is null, see ai-service/app/drafting/schemas.py) the same way the
 *  Plan Epic path already does for planned issues.
 *
 *  The rule that needs its own module is what happens when the user overrides the number: the
 *  points input stays freely editable (most issues are still created without pressing the AI button
 *  at all), and once someone types a different number the model's sentence no longer explains the
 *  value in the field. Rather than showing a rationale for a number nobody proposed, the suggestion
 *  is matched against the current input and simply falls away when they diverge — and comes back if
 *  the user types the suggested number again, which is the same thing as agreeing with it.
 */

export type DraftEstimate = {
  readonly points: number;
  readonly rationale: string;
};

/** Build the suggestion to remember from one AI draft response, or null if there's nothing to
 *  explain — no estimate, or an estimate the model declined to justify. */
export function suggestedEstimate(
  points: number | null | undefined,
  rationale: string | null | undefined,
): DraftEstimate | null {
  const text = (rationale ?? '').trim();
  if (points == null || !Number.isFinite(points) || !text) return null;
  return { points, rationale: text };
}

/** The rationale to show under the points field, given whatever is currently typed there — null
 *  once the user has moved the estimate off the suggested number. */
export function rationaleForCurrentPoints(
  suggestion: DraftEstimate | null,
  currentPoints: string,
): string | null {
  if (!suggestion) return null;
  const typed = currentPoints.trim();
  if (!typed) return null;
  return Number(typed) === suggestion.points ? suggestion.rationale : null;
}

/** Carry the rationale into the created issue's description, the way the Plan Epic commit path does
 *  (see ai-service/app/planning/jira_commit_client.py) — otherwise the one piece of context that
 *  justifies the estimate lives only in the modal and is gone the moment the issue is created. */
export function withEstimateRationale(
  description: string,
  rationale: string | null,
): string | undefined {
  const body = description.trim();
  const note = rationale ? `Estimate rationale: ${rationale}` : '';
  return [body, note].filter(Boolean).join('\n\n') || undefined;
}
