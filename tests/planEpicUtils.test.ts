import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasCompleteBucketLayout,
  isConcreteDependencyReason,
  isValidStoryPoint,
  MAX_SPRINT_NAME_LENGTH,
  needsExtraSprintAcceptance,
  nextManualTempId,
  normalizeSprintNameInput,
  normalizedSprintName,
  uniqueSprintName,
} from '../src/components/planEpicUtils.ts';

test('long sprint names remain intact while pasted line breaks become spaces', () => {
  assert.equal(
    normalizeSprintNameInput('Enable full lifecycle support\nfor the new vendor'),
    'Enable full lifecycle support for the new vendor',
  );
});

test('restored bucket layouts require unique issues and an exact valid destination for every issue', () => {
  assert.equal(hasCompleteBucketLayout(['1', '2'], [0, 1], { 1: 0, 2: 1 }), true);
  assert.equal(hasCompleteBucketLayout(['1', '2'], [0, 1], { 1: 0 }), false);
  assert.equal(hasCompleteBucketLayout(['1', '1'], [0], { 1: 0 }), false);
  assert.equal(hasCompleteBucketLayout(['1'], [0, 0], { 1: 0 }), false);
});

test('manual issue IDs skip IDs already present after workflow restore', () => {
  assert.deepEqual(
    nextManualTempId(['1', 'manual-1', 'manual-2'], 0),
    { tempId: 'manual-3', counter: 3 },
  );
});

test('story points accept only the planning scale used by the AI contract', () => {
  assert.equal(isValidStoryPoint(1), true);
  assert.equal(isValidStoryPoint(8), true);
  assert.equal(isValidStoryPoint(null), false);
  assert.equal(isValidStoryPoint(4), false);
  assert.equal(isValidStoryPoint(1.5), false);
  assert.equal(isValidStoryPoint(21), false);
});

test('any bucket beyond the requested count needs explicit acceptance', () => {
  assert.equal(needsExtraSprintAcceptance(3, 2, false), true);
  assert.equal(needsExtraSprintAcceptance(3, 2, true), false);
  assert.equal(needsExtraSprintAcceptance(2, 2, false), false);
  assert.equal(needsExtraSprintAcceptance(3, null, false), false);
});

test('sprint-name comparison ignores surrounding whitespace and case', () => {
  assert.equal(normalizedSprintName('  Vendor Launch — Sprint 1  '), 'vendor launch — sprint 1');
});

test('generated sprint names avoid both historical and in-plan duplicates', () => {
  const reserved = new Set(['vendor launch — sprint 1', 'vendor launch — sprint 1 (2)']);
  assert.equal(uniqueSprintName('Vendor Launch — Sprint 1', reserved), 'Vendor Launch — Sprint 1 (3)');
  assert.equal(uniqueSprintName('Vendor Launch — Sprint 1', reserved), 'Vendor Launch — Sprint 1 (4)');
});

test('generated sprint names stay within Jira\'s 100-character limit including uniqueness suffixes', () => {
  const longBase = `Vendor lifecycle ${'x'.repeat(120)}`;
  const first = uniqueSprintName(longBase, new Set());
  const reserved = new Set([normalizedSprintName(first)]);
  const second = uniqueSprintName(longBase, reserved);

  assert.equal(Array.from(first).length, MAX_SPRINT_NAME_LENGTH);
  assert.equal(Array.from(second).length, MAX_SPRINT_NAME_LENGTH);
  assert.match(second, / \(2\)$/);
  assert.notEqual(first, second);
});

test('circular dependency wording is rejected but a concrete consequence is accepted', () => {
  const circularReasons = [
    'This issue needs the completed output of “Define access rules” before work can begin.',
    'Work cannot begin until the dependency is complete.',
    'This work has to wait for Define access rules to finish.',
    'Issue 2 depends on Issue 1, so Issue 1 must be done first.',
    'The prerequisite needs to be completed before this work can proceed.',
    'We need to wait for the access rules because they have to be ready first.',
  ];
  circularReasons.forEach((reason) => assert.equal(isConcreteDependencyReason(reason), false, reason));
  assert.equal(
    isConcreteDependencyReason(
      'The team needs the approved permission rules first; starting earlier could expose vendor data to the wrong roles and require the export flow to be rewritten.',
    ),
    true,
  );
  assert.equal(
    isConcreteDependencyReason(
      'UI tests need the completed status and download interfaces to verify loading, progress, failure, and success behavior.',
    ),
    true,
  );
  assert.equal(
    isConcreteDependencyReason(
      'End-to-end tests need the implemented worker behavior so they can verify real state transitions rather than placeholders.',
    ),
    true,
  );
  assert.equal(
    isConcreteDependencyReason(
      'The job needs the approved permission scope before it reads records; starting first could allow unauthorized data into generated files or require reworking the contract.',
    ),
    true,
  );
  assert.equal(
    isConcreteDependencyReason(
      'The download flow needs the job output contract so it knows which file metadata to expose; starting earlier risks mismatched job and file states.',
    ),
    true,
  );
  assert.equal(
    isConcreteDependencyReason(
      'Storage needs the job completion state and output contract so files are saved only after successful generation and linked to the correct export.',
    ),
    true,
  );
  assert.equal(
    isConcreteDependencyReason(
      'The interface needs the final job states to display meaningful status instead of inventing client-side assumptions.',
    ),
    true,
  );
});
