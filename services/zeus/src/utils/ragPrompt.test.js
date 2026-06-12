import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RAG_SYSTEM_PROMPT,
  buildRagContextFromDocs,
  buildRagMessages
} from './ragPrompt.js';

test('builds RAG context using the internal RAG fragment format', () => {
  const context = buildRagContextFromDocs([
    {
      filename: 'Guide',
      content: 'Step 1\nStep 2',
      metadata: { link: 'https://example.test/guide' }
    }
  ]);

  assert.equal(context, [
    'Relevant fragments:',
    '',
    '1. From document Guide:',
    'Document metadata:',
    '- link: https://example.test/guide',
    'Step 1\nStep 2'
  ].join('\n'));
});

test('builds messages for the external LLM without generating an answer internally', () => {
  const context = 'Relevant fragments:\n\n1. From document Guide:\nDo the thing.';
  const messages = buildRagMessages({
    question: 'Как сделать?',
    context
  });

  assert.deepEqual(messages, [
    {
      role: 'system',
      content: RAG_SYSTEM_PROMPT
    },
    {
      role: 'user',
      content: `Context:\n${context}\n\nQuestion: Как сделать?`
    }
  ]);
});
