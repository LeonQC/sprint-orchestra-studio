import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAiTime, formatEstimatedCost, formatModelCost, formatTokenCount } from '../src/components/aiUsageUtils.ts';

test('formats token counts as readable whole numbers', () => {
  assert.equal(formatTokenCount(6532), '6,532');
  assert.equal(formatTokenCount(-10), '0');
});

test('keeps small estimated costs visible without implying billing precision', () => {
  assert.equal(formatEstimatedCost(0.0033), '$0.003300');
  assert.equal(formatEstimatedCost(0.0000004), '<$0.000001');
  assert.equal(formatEstimatedCost(0), 'Free / local');
});

test('distinguishes local-free usage from unknown hosted pricing', () => {
  assert.equal(formatModelCost(0, 'free_local'), 'No API charge');
  assert.equal(formatModelCost(0, 'unavailable'), 'Price unavailable');
  assert.equal(formatModelCost(0.00032, 'estimated'), '$0.000320');
});

test('formats AI duration consistently', () => {
  assert.equal(formatAiTime(7.426), '7.43s');
  assert.equal(formatAiTime(Number.NaN), '—');
});
