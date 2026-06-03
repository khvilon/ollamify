import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertValidProjectName,
  normalizeProjectName,
  quoteIdentifier,
  validateProjectName
} from './projectNames.js';

test('normalizes and accepts expected project names', () => {
  assert.equal(normalizeProjectName('  test_project-1  '), 'test_project-1');
  assert.equal(assertValidProjectName('тест_01'), 'тест_01');
  assert.equal(quoteIdentifier('тест_01'), '"тест_01"');
});

test('rejects SQL identifier injection and reserved schemas', () => {
  for (const name of [
    '',
    '   ',
    'public',
    'admin',
    'information_schema',
    'pg_catalog',
    'project"; DROP SCHEMA admin; --',
    'bad.name',
    '../bad'
  ]) {
    assert.equal(validateProjectName(name).valid, false, name);
    assert.throws(() => assertValidProjectName(name), /Invalid project name/);
  }
});

test('rejects names longer than PostgreSQL identifier limit', () => {
  const tooLong = 'a'.repeat(64);
  assert.equal(validateProjectName(tooLong).valid, false);
  assert.throws(() => quoteIdentifier(tooLong), /Invalid project name/);
});
