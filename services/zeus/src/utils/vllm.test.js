import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVllmModelOptionsFromOllamaIndex,
  doesVllmServeModel,
  normalizeVllmRequestedModel
} from './vllm.js';

test('normalizes explicit vllm model prefix and HuggingFace URLs', () => {
  assert.equal(normalizeVllmRequestedModel('vllm/Qwen/Qwen2.5-7B-Instruct'), 'Qwen/Qwen2.5-7B-Instruct');
  assert.equal(normalizeVllmRequestedModel('https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct'), 'meta-llama/Llama-3.1-8B-Instruct');
});

test('matches current vLLM model by exact requested model id', () => {
  const status = {
    available: true,
    state: 'running',
    current_model: 'Qwen/Qwen2.5-7B-Instruct'
  };

  assert.equal(doesVllmServeModel(status, 'Qwen/Qwen2.5-7B-Instruct'), true);
  assert.equal(doesVllmServeModel(status, 'vllm/Qwen/Qwen2.5-7B-Instruct'), true);
  assert.equal(doesVllmServeModel(status, 'llama3.1:8b'), false);
});

test('matches vLLM served model aliases returned by /v1/models', () => {
  const status = {
    available: true,
    state: 'running',
    current_model: 'Qwen/Qwen2.5-7B-Instruct',
    served_models: ['chat-local', 'Qwen/Qwen2.5-7B-Instruct']
  };

  assert.equal(doesVllmServeModel(status, 'chat-local'), true);
});

test('does not match when vLLM is unavailable or not running', () => {
  assert.equal(doesVllmServeModel({ available: false, state: 'running', current_model: 'x' }, 'x'), false);
  assert.equal(doesVllmServeModel({ available: true, state: 'loading', current_model: 'x' }, 'x'), false);
});

test('builds vLLM model options from installed Ollama completion models', () => {
  const idx = {
    modelsByInstance: new Map([
      [0, [
        { name: 'qwen3.5:9b', capabilities: ['vision', 'completion', 'tools'] },
        { name: 'qwen3-embedding:8b', capabilities: ['embedding'] },
        { name: 'qwen3:8b', details: { family: 'qwen3' } }
      ]],
      [1, [
        { name: 'qwen3.5:9b', capabilities: ['completion'] },
        { model: 'llama3.1:8b', capabilities: ['completion'] }
      ]]
    ])
  };

  assert.deepEqual(
    buildVllmModelOptionsFromOllamaIndex(idx),
    ['qwen3.5:9b', 'qwen3:8b', 'llama3.1:8b']
  );
});
