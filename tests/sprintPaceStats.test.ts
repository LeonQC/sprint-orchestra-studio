import assert from 'node:assert/strict';
import test from 'node:test';
import { computeSprintPaceStats } from '../src/utils/sprintPaceStats.ts';
import type { Sprint } from '../src/types/sprint.ts';
import type { Ticket } from '../src/types/ticket.ts';

const baseSprint: Sprint = {
  id: '7',
  name: 'Sprint 7',
  status: 'active',
  startDate: '2026-08-01',
  endDate: '2026-08-21',
};

test('pace is unavailable when sprint dates are missing', () => {
  const stats = computeSprintPaceStats(
    { ...baseSprint, startDate: '', endDate: '' },
    [{ id: 'PAY-1', title: 'Checkout', status: 'done', storyPoints: 5 } as Ticket],
  );
  assert.equal(stats.riskLevel, 'unavailable');
});

test('pace is incomplete when a sprint issue has no estimated points', () => {
  const stats = computeSprintPaceStats(
    baseSprint,
    [{ id: 'PAY-1', title: 'Checkout', status: 'planned' } as Ticket],
  );
  assert.equal(stats.riskLevel, 'incomplete');
  assert.deepEqual(stats.unestimatedIssues.map((issue) => issue.issueKey), ['PAY-1']);
});

test('one missing estimate prevents a partial point subtotal from becoming an overall pace label', () => {
  const stats = computeSprintPaceStats(
    baseSprint,
    [
      { id: 'PAY-1', title: 'Estimated work', status: 'done', storyPoints: 5 } as Ticket,
      { id: 'PAY-2', title: 'Unknown work', status: 'planned' } as Ticket,
    ],
  );
  assert.equal(stats.completedPoints, 5);
  assert.equal(stats.totalPoints, 5);
  assert.equal(stats.riskLevel, 'incomplete');
  assert.deepEqual(stats.unestimatedIssues.map((issue) => issue.issueKey), ['PAY-2']);
  assert.notEqual(stats.daysRemaining, null);
});

test('zero points is treated as a missing estimate, including on completed work', () => {
  const stats = computeSprintPaceStats(
    baseSprint,
    [{ id: 'PAY-3', title: 'Legacy completed work', status: 'done', issueType: 'story', storyPoints: 0 } as Ticket],
  );
  assert.equal(stats.riskLevel, 'incomplete');
  assert.deepEqual(stats.unestimatedIssues.map((issue) => issue.issueKey), ['PAY-3']);
});
