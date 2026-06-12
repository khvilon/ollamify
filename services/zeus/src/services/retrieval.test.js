import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeRetrievalOptions,
  serializeRetrievedDocument
} from './retrieval.js';

test('normalizes explicit keyword retrieval options', () => {
  const options = normalizeRetrievalOptions({
    mode: 'keyword',
    limit: '7',
    useReranker: 'true',
    includeAdjacentChunks: 'false',
    minScore: '0.25'
  });

  assert.equal(options.mode, 'keyword');
  assert.equal(options.limit, 7);
  assert.equal(options.useReranker, true);
  assert.equal(options.includeAdjacentChunks, false);
  assert.equal(options.minScore, 0.25);
});

test('keeps legacy useHybridSearch=false as vector search', () => {
  const options = normalizeRetrievalOptions({
    useHybridSearch: false,
    limit: 0
  });

  assert.equal(options.mode, 'vector');
  assert.equal(options.limit, 1);
});

test('serializes retrieved chunks with stable source coordinates', () => {
  const doc = serializeRetrievedDocument({
    filename: 'guide.pdf',
    content: 'Step one',
    project: 'warehouse',
    document_id: 42,
    chunk_index: 3,
    similarity: 0.91,
    metadata: { section: 'Inbound' },
    extracted_metadata: { 'tracker.keys': ['DEV-123'] }
  });

  assert.deepEqual(doc, {
    filename: 'guide.pdf',
    content: 'Step one',
    project: 'warehouse',
    document_id: 42,
    chunk_index: 3,
    similarity: 0.91,
    metadata: { section: 'Inbound' },
    extracted_metadata: { 'tracker.keys': ['DEV-123'] }
  });
});
