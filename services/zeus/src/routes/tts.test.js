import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_TTS_SPEED, normalizeTtsSynthesisTimeoutMs } from './tts.js';

test('defaults TTS synthesis timeout to five minutes for CPU generation', () => {
  assert.equal(normalizeTtsSynthesisTimeoutMs(undefined), 300000);
});

test('allows overriding TTS synthesis timeout from environment', () => {
  assert.equal(normalizeTtsSynthesisTimeoutMs('420000'), 420000);
});

test('defaults TTS speaking speed to 0.65', () => {
  assert.equal(DEFAULT_TTS_SPEED, 0.65);
});
