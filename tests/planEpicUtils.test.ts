import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasCompleteBucketLayout,
  hasPlanEpicInputs,
  isValidStoryPoint,
  MAX_SPRINT_NAME_LENGTH,
  needsExtraSprintAcceptance,
  nextManualTempId,
  normalizeSprintNameInput,
  normalizedSprintName,
  uniqueSprintName,
  parsedRequirements,
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

test('parsedRequirements: one requirement per line, list markers stripped', () => {
  // People paste bullets out of a doc or a ticket, and the marker comes with them. Keeping it would
  // put a bullet character into the retrieval query, where it is noise the embedding averages away.
  assert.deepEqual(
    parsedRequirements('- Upload a spreadsheet\n* Validate every row\n1. Restrict to admins'),
    ['Upload a spreadsheet', 'Validate every row', 'Restrict to admins'],
  );
  assert.deepEqual(parsedRequirements('• Bullet char too'), ['Bullet char too']);
});

test('parsedRequirements: blank lines are dropped, not sent as empty requirements', () => {
  // The server would ignore them, but they would throw off the 1-based numbering the plan cites back.
  assert.deepEqual(parsedRequirements('One\n\n   \nTwo\n'), ['One', 'Two']);
  assert.deepEqual(parsedRequirements(''), []);
  assert.deepEqual(parsedRequirements('   \n  '), []);
});

test('parsedRequirements: a hyphen inside the text survives', () => {
  assert.deepEqual(
    parsedRequirements('Support multi-currency pricing - including refunds'),
    ['Support multi-currency pricing - including refunds'],
  );
});

test('plan generation requires a proposal and meaningful requirement text', () => {
  assert.equal(hasPlanEpicInputs('Bulk price updates', ''), false);
  assert.equal(hasPlanEpicInputs('Bulk price updates', '   \n - \n1. \n•'), false);
  assert.equal(hasPlanEpicInputs('   ', 'Only sellers can update prices'), false);
  assert.equal(hasPlanEpicInputs('Bulk price updates', '\n - Only sellers can update prices \n'), true);
});
