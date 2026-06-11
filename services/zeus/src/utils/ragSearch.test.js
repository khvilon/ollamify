import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDeterministicKeywords,
  buildDeterministicSearchQuery,
  extractSearchTokens
} from './ragSearch.js';

test('builds a content-only search query without generic question words', () => {
  assert.equal(
    buildDeterministicSearchQuery('как закрыть приемку?'),
    'закрыть приемку'
  );
});

test('keeps all important short and long terms for RF cross-dock questions', () => {
  const tokens = extractSearchTokens('как закрыть документ приемки для перегрузки на РЧ?');

  assert.deepEqual(tokens, ['закрыть', 'документ', 'приемки', 'перегрузки', 'рч']);
});

test('adds phrase and morphology keyword variants without domain dictionaries', () => {
  const keywords = buildDeterministicKeywords('как закрыть приемку?', 16);

  assert.ok(keywords.includes('закрыть'));
  assert.ok(keywords.includes('приемку'));
  assert.ok(keywords.includes('закрыть приемку'));
  assert.ok(keywords.includes('закрытие'));
  assert.ok(!keywords.includes('закрыние'));
  assert.ok(keywords.includes('приемка'));
});

test('extracts shipment-order keywords without keeping stop words', () => {
  const keywords = buildDeterministicKeywords('как создать заказ на отгрузку?', 16);

  assert.ok(keywords.includes('создать'));
  assert.ok(keywords.includes('заказ'));
  assert.ok(keywords.includes('отгрузку'));
  assert.ok(keywords.includes('создать заказ'));
  assert.ok(keywords.includes('создание'));
  assert.ok(!keywords.includes('создатие'));
  assert.ok(!keywords.includes('как'));
  assert.ok(!keywords.includes('на'));
});
