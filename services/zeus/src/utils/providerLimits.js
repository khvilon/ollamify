import { createRequestLimiter } from './requestLimiter.js';

const ollamaLimiters = new Map();
const vllmLimiter = createRequestLimiter({
  maxActive: Number(process.env.OLLAMIFY_VLLM_MAX_ACTIVE) || 64,
  maxQueue: Number(process.env.OLLAMIFY_VLLM_MAX_QUEUE) || 128,
  queueTimeoutMs: Number(process.env.OLLAMIFY_VLLM_QUEUE_TIMEOUT_MS) || 30_000
});

function getOllamaLimiter(instanceId) {
  const key = instanceId === undefined || instanceId === null ? 'default' : String(instanceId);
  if (!ollamaLimiters.has(key)) {
    ollamaLimiters.set(key, createRequestLimiter({
      maxActive: Number(process.env.OLLAMIFY_OLLAMA_MAX_ACTIVE_PER_INSTANCE) || 1,
      maxQueue: Number(process.env.OLLAMIFY_OLLAMA_MAX_QUEUE_PER_INSTANCE) || 32,
      queueTimeoutMs: Number(process.env.OLLAMIFY_OLLAMA_QUEUE_TIMEOUT_MS) || 60_000
    }));
  }
  return ollamaLimiters.get(key);
}

export function runOllamaLimited({ instanceId = null, model = '', label = '' } = {}, fn) {
  return getOllamaLimiter(instanceId).run(`${label}:${model}`, fn);
}

export function runVllmLimited({ model = '', label = '' } = {}, fn) {
  return vllmLimiter.run(`${label}:${model}`, fn);
}

export function getProviderLimitSnapshots() {
  const ollama = {};
  for (const [key, limiter] of ollamaLimiters.entries()) {
    ollama[key] = limiter.snapshot();
  }

  return {
    ollama,
    vllm: vllmLimiter.snapshot()
  };
}
