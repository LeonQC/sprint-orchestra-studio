import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, parseApiError } from '../src/api/apiError.ts';

test('uses FastAPI detail without displaying the raw JSON envelope', () => {
  const error = parseApiError(409, '{"detail":"A recovery check is already in progress."}');
  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 409);
  assert.equal(error.message, 'A recovery check is already in progress.');
});

test('does not render an HTML or malformed error body into the UI', () => {
  assert.equal(parseApiError(502, '<html>proxy error</html>').message, 'Request failed (502)');
  assert.equal(parseApiError(500, '{bad json').message, 'Request failed (500)');
});
