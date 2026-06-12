import test from 'node:test';
import assert from 'node:assert/strict';

import * as mcpServer from './server.js';

test('MCP exposes guided RAG context but not raw search or project listing tools', () => {
  const { OLLAMIFY_MCP_TOOL_NAMES } = mcpServer;

  assert.ok(OLLAMIFY_MCP_TOOL_NAMES.includes('ollamify_rag_context'));
  assert.equal(OLLAMIFY_MCP_TOOL_NAMES.includes('ollamify_search_documents'), false);
  assert.equal(OLLAMIFY_MCP_TOOL_NAMES.includes('ollamify_list_projects'), false);
});

test('MCP does not expose project listing resources', () => {
  assert.deepEqual(mcpServer.OLLAMIFY_MCP_RESOURCE_NAMES, []);
});
