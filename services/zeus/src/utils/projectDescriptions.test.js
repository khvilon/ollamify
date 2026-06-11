import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeProjectDescription,
  validateProjectDescription
} from './projectDescriptions.js';

test('normalizes missing project descriptions to an empty string', () => {
  assert.equal(normalizeProjectDescription(undefined), '');
  assert.equal(normalizeProjectDescription(null), '');
});

test('trims project descriptions without removing meaningful inner whitespace', () => {
  assert.equal(
    normalizeProjectDescription('  Warehouse RF manuals\nInbound and outbound flows  '),
    'Warehouse RF manuals\nInbound and outbound flows'
  );
});

test('rejects project descriptions that are too long for agent context', () => {
  const result = validateProjectDescription('x'.repeat(4001));

  assert.equal(result.valid, false);
  assert.match(result.reason, /4000 characters or less/);
});
