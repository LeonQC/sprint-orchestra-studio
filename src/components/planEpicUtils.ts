export const MAX_SPRINT_NAME_LENGTH = 100;

export const normalizedSprintName = (name: string) => name.trim().toLocaleLowerCase();

function fitSprintName(base: string, suffix = ''): string {
  const suffixLength = Array.from(suffix).length;
  const available = Math.max(0, MAX_SPRINT_NAME_LENGTH - suffixLength);
  const shortenedBase = Array.from(base.trim()).slice(0, available).join('').trimEnd();
  return `${shortenedBase}${suffix}`;
}

export function uniqueSprintName(base: string, reservedNames: Set<string>): string {
  let candidate = fitSprintName(base);
  let suffix = 2;
  while (reservedNames.has(normalizedSprintName(candidate))) {
    candidate = fitSprintName(base, ` (${suffix})`);
    suffix += 1;
  }
  reservedNames.add(normalizedSprintName(candidate));
  return candidate;
}

/** Sprint names are visually multi-line for review, but Jira receives one clean line. */
export function normalizeSprintNameInput(name: string): string {
  return name.replace(/\s*[\r\n]+\s*/g, ' ');
}

export const STORY_POINT_VALUES = new Set([1, 2, 3, 5, 8, 13]);

export function isValidStoryPoint(value: number | null): boolean {
  return value != null && Number.isInteger(value) && STORY_POINT_VALUES.has(value);
}

export function needsExtraSprintAcceptance(
  activeBucketCount: number,
  requestedSprintCount: number | null,
  accepted: boolean,
): boolean {
  return requestedSprintCount != null
    && activeBucketCount > requestedSprintCount
    && !accepted;
}

export function hasCompleteBucketLayout(
  issueTempIds: string[],
  bucketOrder: number[],
  bucketAssignment: Record<string, number>,
): boolean {
  if (!issueTempIds.length || !bucketOrder.length) return false;
  const bucketIndexes = new Set(bucketOrder);
  if (bucketIndexes.size !== bucketOrder.length) return false;
  if (issueTempIds.some((tempId) => !tempId) || new Set(issueTempIds).size !== issueTempIds.length) {
    return false;
  }
  return issueTempIds.every((tempId) => bucketIndexes.has(bucketAssignment[tempId]));
}

export function nextManualTempId(existingTempIds: Iterable<string>, currentCounter: number) {
  const existing = new Set(existingTempIds);
  let counter = currentCounter;
  let tempId: string;
  do {
    counter += 1;
    tempId = `manual-${counter}`;
  } while (existing.has(tempId));
  return { tempId, counter };
}

/** Requirement bullets from free text: one per line, leading list markers stripped.
 *
 *  Tolerant on purpose. People paste from a doc or a ticket and the leading "- ", "* " or "1. " comes
 *  with them; keeping those would put them into the retrieval query, where a bullet character is
 *  noise the embedding has to average away. Blank lines are dropped rather than sent as empty
 *  requirements, which the server would ignore anyway but which would throw the 1-based numbering the
 *  plan cites back off by one. */
export function parsedRequirements(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0);
}
