import { hasValidStoryPoints } from '../types/ticket';

export type CreateIssueInSprint = (
  sprintId: string | null,
  title: string,
  storyPoints?: number,
) => void;

/** Keeps the inline row's title and estimate together when binding it to a sprint. A previous inline
 * wrapper accepted only `title`, so React correctly supplied `storyPoints` and the wrapper silently
 * discarded it before the validation/API layer. Centralising the binding makes that data flow
 * explicit and regression-testable. */
export function bindInlineIssueToSprint(
  createIssue: CreateIssueInSprint,
  sprintId: string | null,
): (title: string, storyPoints?: number) => void {
  return (title, storyPoints) => createIssue(sprintId, title, storyPoints);
}

/** The inline button and save action must accept exactly the same values as the final context guard:
 * story points are positive whole numbers. */
export function parseInlineStoryPoints(value: string): number | undefined {
  const parsed = Number(value);
  return hasValidStoryPoints(parsed) ? parsed : undefined;
}
