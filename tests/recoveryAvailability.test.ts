import assert from 'node:assert/strict';
import test from 'node:test';
import type { RecoveryStatusDto } from '../src/api/aiApi.ts';
import { normalizeRecoveryLookup } from '../src/components/recoveryAvailability.ts';

test('normalizes the old null lookup response without dereferencing null', () => {
  assert.deepEqual(normalizeRecoveryLookup(null), { availability: 'none', recovery: null });
});

test('normalizes the old bare recovery response as resumable', () => {
  const recovery = { threadId: 'legacy-thread' } as RecoveryStatusDto;
  assert.deepEqual(normalizeRecoveryLookup(recovery), { availability: 'resumable', recovery });
});

test('preserves the new explicit busy response', () => {
  assert.deepEqual(
    normalizeRecoveryLookup({
      availability: 'busy', recovery: null,
      ownerUsername: 'atlascart.maya', currentStatus: 'awaiting_plan_approval',
    }),
    {
      availability: 'busy', recovery: null,
      ownerUsername: 'atlascart.maya', currentStatus: 'awaiting_plan_approval',
    },
  );
});
