/** The AI draft's story-point suggestion in Create Issue, and its rationale ("why 5?").
 *  The points field stays freely editable. Once the user types a different number, the AI's sentence
 *  no longer explains it, so the suggestion hides; typing the suggested number again brings it back. */

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
