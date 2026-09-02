import assert from 'node:assert/strict';
import test from 'node:test';
import {
  rationaleForCurrentPoints,
  suggestedEstimate,
  withEstimateRationale,
} from '../src/utils/draftEstimate.ts';

test('a draft with no estimate has nothing to explain', () => {
  assert.equal(suggestedEstimate(null, null), null);
  // The server enforces the pairing, but a rationale arriving without a number must not leave a
  // dangling explanation attached to whatever the user types next.
  assert.equal(suggestedEstimate(null, 'Feels smallish.'), null);
});

test('an estimate the model declined to justify is kept out of the UI', () => {
  assert.equal(suggestedEstimate(5, ''), null);
  assert.equal(suggestedEstimate(5, '   '), null);
});

test('the rationale shows while the points field still holds the suggested number', () => {
  const suggestion = suggestedEstimate(5, 'Touches two services and the payment schema.');

  assert.equal(
    rationaleForCurrentPoints(suggestion, '5'),
    'Touches two services and the payment schema.',
  );
});

test('overriding the number drops the rationale, and typing it back restores it', () => {
  const suggestion = suggestedEstimate(5, 'Touches two services.');

  // The sentence explains a 5; it explains nothing about a 13 the user chose themselves.
  assert.equal(rationaleForCurrentPoints(suggestion, '13'), null);
  assert.equal(rationaleForCurrentPoints(suggestion, ''), null);
  assert.equal(rationaleForCurrentPoints(suggestion, ' 5 '), 'Touches two services.');
});

test('nothing to show when the AI draft was never run', () => {
  assert.equal(rationaleForCurrentPoints(null, '5'), null);
});

test('the rationale is appended to the description so it survives issue creation', () => {
  assert.equal(
    withEstimateRationale('Sellers keep uploading huge images.', 'Touches two services.'),
    'Sellers keep uploading huge images.\n\nEstimate rationale: Touches two services.',
  );
});

test('an issue created without the AI draft keeps exactly the description that was typed', () => {
  assert.equal(withEstimateRationale('  Just a note.  ', null), 'Just a note.');
  assert.equal(withEstimateRationale('   ', null), undefined);
});

test('a rationale alone still produces a description rather than an empty issue body', () => {
  assert.equal(
    withEstimateRationale('', 'Well-understood middleware change.'),
    'Estimate rationale: Well-understood middleware change.',
  );
});
