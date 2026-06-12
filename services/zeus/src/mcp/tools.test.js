import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMcpToolResult,
  normalizeMcpRagContextInput
} from './tools.js';

test('normalizes MCP RAG context input with internal RAG defaults', () => {
  const input = normalizeMcpRagContextInput({
    question: 'How does indexing work?',
    project: 'docs',
    limit: '500',
    rerank: false,
    includeAdjacentChunks: 'false',
    contextCharLimit: '12000'
  });

  assert.deepEqual(input, {
    query: 'How does indexing work?',
    project: 'docs',
    mode: 'hybrid',
    limit: 100,
    useReranker: false,
    includeAdjacentChunks: false,
    smartSelect: true,
    contextCharLimit: 12000,
    minScore: undefined,
    keywords: undefined
  });
});

test('builds MCP tool results with text and structured content', () => {
  const payload = {
    projects: [
      {
        name: 'docs',
        description: 'Internal manuals',
        embedding_model: 'frida'
      }
    ]
  };

  const result = buildMcpToolResult(payload);

  assert.deepEqual(result.structuredContent, payload);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  assert.match(result.content[0].text, /Internal manuals/);
});
