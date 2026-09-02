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

export function isConcreteDependencyReason(reason: string | undefined): boolean {
  if (!reason || reason.trim().length < 25) return false;
  const normalized = reason.trim().toLocaleLowerCase();
  const circularPatterns: RegExp[] = [
    /\bneeds? (?:the )?completed output of\b/,
    /\bmust be (?:completed|finished|done) before (?:work )?can (?:begin|start|continue|proceed)\b/,
    /\bmust (?:finish|be finished|be done) before (?:this (?:issue|work) )?can (?:start|begin)\b/,
    /\b(?:cannot|can't) (?:start|begin|continue|proceed) until\b.*\b(?:complete|completed|finished|done)\b/,
    /\bhas to wait (?:for|until)\b.*\b(?:finish|finished|complete|completed|done)\b/,
    /\bdepends on\b.*\b(?:must|needs? to|has to) (?:finish|be finished|be completed|be done) first\b/,
    /\b(?:dependency|prerequisite) (?:must|needs? to|has to) (?:finish|be completed|be done) before\b/,
    /\b(?:so|because)\b.{0,50}\b(?:can|has to|needs? to|must)\b.{0,25}\b(?:start|begin|proceed|be ready)\b/,
  ];
  if (circularPatterns.some((pattern) => pattern.test(normalized))) return false;

  // A useful reason must state an observable consequence, not merely rephrase the arrow as
  // "wait because the first thing has to be ready". This deliberately checks practical language
  // rather than technical vocabulary so product/QA/design explanations pass too.
  const consequencePatterns: RegExp[] = [
    /\b(?:could|would|may|might)\b.{0,100}\b(?:fail|break|expose|leak|mislead|conflict|duplicate|invalidate|block|delay|risk|rework|rewrite|rebuild|guess|incorrect|wrong|unsafe|insecure)\b/,
    /\b(?:could|would|may|might)\b.{0,100}\b(?:allow|cause|lead|result|force|require|leave|make)\b/,
    /\b(?:risks?|risking|causes?|leads? to|results? in|forces?)\b/,
    /\b(?:otherwise|without (?:it|this|that|those|them))\b.{0,120}\b(?:fail|break|risk|rework|rewrite|rebuild|guess|incorrect|wrong|unsafe|insecure|could|would|may|might)\b/,
    /\b(?:to avoid|to prevent|so (?:the )?team (?:does not|doesn't|won't))\b/,
    /\b(?:to|in order to)\b.{0,80}\b(?:verify|validate|detect|prevent|protect|enforce|render|show|calculate|measure|compare|exercise|store|retrieve|download|trace|audit)\b/,
    /\bso\b.{0,60}\bcan\b.{0,60}\b(?:verify|validate|detect|prevent|protect|enforce|render|show|calculate|measure|compare|exercise|store|retrieve|download|trace|audit)\b/,
    /\bso\b.{0,140}\b(?:accurate|correct|only|safely|securely|consistently|actual|real|specific|matched?|linked?|saved?|generated?|authorized|approved)\b/,
    /\b(?:rather than|instead of)\b/,
  ];
  return consequencePatterns.some((pattern) => pattern.test(normalized));
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
