import test from 'node:test';
import assert from 'node:assert/strict';

import { OLLAMIFY_MCP_TOOL_NAMES } from './server.js';

test('MCP exposes RAG context but not raw document search', () => {
  assert.ok(OLLAMIFY_MCP_TOOL_NAMES.includes('ollamify_rag_context'));
  assert.equal(OLLAMIFY_MCP_TOOL_NAMES.includes('ollamify_search_documents'), false);
});
