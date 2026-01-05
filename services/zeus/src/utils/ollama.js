import fetch from 'node-fetch';
import logger from './logger.js';

const OLLAMA_PRIMARY_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
const OLLAMA_SECONDARY_URL = process.env.OLLAMA1_URL || 'http://ollama1:11434';

const OLLAMA_PROBE_TIMEOUT_MS = Number(process.env.OLLAMA_PROBE_TIMEOUT_MS) || 2000;
const OLLAMA_TAGS_TIMEOUT_MS = Number(process.env.OLLAMA_TAGS_TIMEOUT_MS) || 10000;
const OLLAMA_TAGS_RETRIES = Number(process.env.OLLAMA_TAGS_RETRIES) || 1;
const OLLAMA_TAGS_RETRY_DELAY_MS = Number(process.env.OLLAMA_TAGS_RETRY_DELAY_MS) || 250;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeOllama(baseUrl, timeoutMs = OLLAMA_PROBE_TIMEOUT_MS) {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/api/version`, { method: 'GET' }, timeoutMs);
    return res.ok;
  } catch {
    return false;
  }
}

let modelIndexCache = {
  updatedAt: 0,
  instances: [],
  // model name -> instance
  modelToInstance: new Map(),
  // instanceId -> models[]
  modelsByInstance: new Map(),
};

let refreshInFlight = null;

export async function getOllamaInstances() {
  const instances = [
    { id: 0, name: 'GPU 0', baseUrl: OLLAMA_PRIMARY_URL },
  ];

  // Secondary instance is optional (only when 2+ NVIDIA GPUs are used)
  if (await probeOllama(OLLAMA_SECONDARY_URL)) {
    instances.push({ id: 1, name: 'GPU 1', baseUrl: OLLAMA_SECONDARY_URL });
  }

  return instances;
}

export async function refreshOllamaModelIndex({ force = false } = {}) {
  const CACHE_TTL_MS = 5_000;
  const now = Date.now();
  if (!force && (now - modelIndexCache.updatedAt) < CACHE_TTL_MS) {
    return modelIndexCache;
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    let instances = await getOllamaInstances();

    // Avoid "flapping" of GPU1 instance due to slow probe: keep recently-seen instance for a short window.
    const STALE_INSTANCE_TTL_MS = 30_000;
    if (!instances.some(i => i.id === 1) && modelIndexCache.instances?.some(i => i.id === 1) && (now - modelIndexCache.updatedAt) < STALE_INSTANCE_TTL_MS) {
      instances = [...instances, { id: 1, name: 'GPU 1', baseUrl: OLLAMA_SECONDARY_URL }];
    }

    const fetchTags = async (inst) => {
      let lastErr = null;
      for (let attempt = 0; attempt <= OLLAMA_TAGS_RETRIES; attempt++) {
        try {
          const res = await fetchWithTimeout(`${inst.baseUrl}/api/tags`, { method: 'GET' }, OLLAMA_TAGS_TIMEOUT_MS);
          if (!res.ok) {
            throw new Error(`Ollama tags failed (${inst.baseUrl}): ${res.status} ${res.statusText}`);
          }
          const data = await res.json();
          return { ok: true, models: Array.isArray(data.models) ? data.models : [] };
        } catch (err) {
          lastErr = err;
          if (attempt < OLLAMA_TAGS_RETRIES) {
            await sleep(OLLAMA_TAGS_RETRY_DELAY_MS);
          }
        }
      }

      logger.warn(`Failed to fetch tags from ${inst.baseUrl}: ${lastErr?.message || lastErr}`);
      return { ok: false, models: null };
    };

    const tagsByInstance = await Promise.all(instances.map(async (inst) => ({
      inst,
      ...(await fetchTags(inst)),
    })));

    const modelToInstance = new Map();
    const modelsByInstance = new Map();
    const prevModelsByInstance = modelIndexCache.modelsByInstance || new Map();

    for (const { inst, ok, models } of tagsByInstance) {
      const finalModels = ok ? models : (prevModelsByInstance.get(inst.id) || []);
      modelsByInstance.set(inst.id, finalModels);
      for (const m of finalModels) {
        if (m?.name && !modelToInstance.has(m.name)) {
          modelToInstance.set(m.name, inst);
        }
      }
    }

    modelIndexCache = {
      updatedAt: now,
      instances,
      modelToInstance,
      modelsByInstance,
    };

    return modelIndexCache;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function resolveOllamaInstanceForModel(modelName) {
  if (!modelName) {
    return { id: 0, name: 'GPU 0', baseUrl: OLLAMA_PRIMARY_URL };
  }

  const idx = await refreshOllamaModelIndex();
  return idx.modelToInstance.get(modelName) || { id: 0, name: 'GPU 0', baseUrl: OLLAMA_PRIMARY_URL };
}

export async function resolveOllamaBaseUrlForModel(modelName) {
  const inst = await resolveOllamaInstanceForModel(modelName);
  return inst.baseUrl;
}

