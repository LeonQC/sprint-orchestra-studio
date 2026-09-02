import assert from 'node:assert/strict';
import test from 'node:test';
import { SPRINT_PACE_HELP, SPRINT_RECOVERY_HELP } from '../src/utils/sprintAiHelp.ts';

test('pace help states the actual schedule thresholds and issue flags', () => {
  const text = JSON.stringify(SPRINT_PACE_HELP);
  assert.match(text, /Up to 10 percentage points behind/);
  assert.match(text, /More than 10 and up to 25 percentage points behind/);
  assert.match(text, /More than 25 percentage points behind/);
  assert.match(text, /more than 3 days/);
  assert.match(text, /Pace incomplete/);
  assert.match(text, /estimated work only/);
  assert.match(text, /name PAY-42/);
  assert.match(text, /50% is expected: 45% done is On track; 35% is At risk; 20% is Behind/);
});

test('recovery help states every deterministic risk threshold', () => {
  const text = JSON.stringify(SPRINT_RECOVERY_HELP);
  assert.match(text, /at least 2 days/);
  assert.match(text, /at least 40%/);
  assert.match(text, /opening 20%/);
  assert.match(text, /more than 20 percentage points behind/);
  assert.match(text, /under 90%/);
  assert.match(text, /half of the sprint/);
  assert.match(text, /must point back to evidence/);
  assert.match(text, /day 6 of 10/);
});
