import test from 'node:test';
import assert from 'node:assert/strict';

import { stripThinkingContent } from './ragText.js';

test('removes closed thinking blocks from retrieval helper output', () => {
  assert.equal(
    stripThinkingContent('<think>hidden reasoning</think>\n["закрыть приемку"]'),
    '["закрыть приемку"]'
  );
});

test('removes unfinished thinking blocks from truncated retrieval helper output', () => {
  assert.equal(
    stripThinkingContent('<think>unfinished reasoning about how to close acceptance'),
    ''
  );
});
