import assert from 'node:assert/strict';
import test from 'node:test';
import { bindInlineIssueToSprint, parseInlineStoryPoints } from '../src/utils/inlineIssueCreate.ts';

test('inline sprint issue binding forwards the entered story points', () => {
  const calls: Array<[string | null, string, number | undefined]> = [];
  const save = bindInlineIssueToSprint(
    (sprintId, title, storyPoints) => calls.push([sprintId, title, storyPoints]),
    '5000104',
  );

  save('test', 1);

  assert.deepEqual(calls, [['5000104', 'test', 1]]);
});

test('inline point validation accepts positive integers and rejects empty, fractional, and zero values', () => {
  assert.equal(parseInlineStoryPoints('1'), 1);
  assert.equal(parseInlineStoryPoints('13'), 13);
  assert.equal(parseInlineStoryPoints(''), undefined);
  assert.equal(parseInlineStoryPoints('0'), undefined);
  assert.equal(parseInlineStoryPoints('1.5'), undefined);
});
