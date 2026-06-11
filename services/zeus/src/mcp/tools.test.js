import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMcpToolResult,
  normalizeMcpSearchInput
} from './tools.js';

test('normalizes MCP search input with common defaults', () => {
  const input = normalizeMcpSearchInput({
    question: 'How does indexing work?',
    project: 'docs',
    limit: '500',
    rerank: true,
    includeAdjacentChunks: 'true'
  });

  assert.deepEqual(input, {
    query: 'How does indexing work?',
    project: 'docs',
    mode: 'hybrid',
    limit: 100,
    useReranker: true,
    includeAdjacentChunks: true,
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
