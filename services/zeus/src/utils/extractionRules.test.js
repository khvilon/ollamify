import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractMetadataFromText,
  parseJsonField,
  validateExtractionRules
} from './extractionRules.js';

test('validates and normalizes regex extraction rules', () => {
  const rules = validateExtractionRules([
    {
      key: 'tracker.keys',
      type: 'regex',
      pattern: '\\bDEV-\\d+\\b',
      flags: 'i'
    }
  ]);

  assert.deepEqual(rules, [
    {
      key: 'tracker.keys',
      type: 'regex',
      pattern: '\\bDEV-\\d+\\b',
      flags: 'gi'
    }
  ]);
});

test('extracts values per chunk and deduplicates in first-seen order', () => {
  const rules = validateExtractionRules([
    {
      key: 'tracker.keys',
      type: 'regex',
      pattern: '\\bDEV-\\d+\\b',
      flags: 'gi'
    }
  ]);

  assert.deepEqual(
    extractMetadataFromText('DEV-123 dev-123 DEV-456 DEV-123', rules),
    {
      'tracker.keys': ['DEV-123', 'dev-123', 'DEV-456']
    }
  );
});

test('returns empty extracted metadata when no rules are provided', () => {
  assert.deepEqual(extractMetadataFromText('DEV-123', []), {});
  assert.deepEqual(validateExtractionRules(undefined), []);
});

test('rejects invalid extraction rules', () => {
  assert.throws(
    () => validateExtractionRules([{ key: 'x', type: 'llm', pattern: 'x' }]),
    /Only regex extraction rules are supported/
  );

  assert.throws(
    () => validateExtractionRules([{ key: 'x', type: 'regex', pattern: '[' }]),
    /Invalid regex pattern/
  );

  assert.throws(
    () => validateExtractionRules([{ key: '', type: 'regex', pattern: 'x' }]),
    /Rule key must be a non-empty string/
  );
});

test('parses JSON fields from object, JSON string, empty input, and rejects arrays for metadata', () => {
  assert.deepEqual(parseJsonField(undefined, 'metadata', {}), {});
  assert.deepEqual(parseJsonField({ a: 1 }, 'metadata', {}), { a: 1 });
  assert.deepEqual(parseJsonField('{"a":1}', 'metadata', {}), { a: 1 });

  assert.throws(
    () => parseJsonField('[1]', 'metadata', {}),
    /metadata must be a JSON object/
  );
});
