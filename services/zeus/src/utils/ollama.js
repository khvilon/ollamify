import fetch from 'node-fetch';
import logger from './logger.js';

const OLLAMA_PRIMARY_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
const OLLAMA_SECONDARY_URL = process.env.OLLAMA1_URL || 'http://ollama1:11434';

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

export async function probeOllama(baseUrl, timeoutMs = 700) {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/api/version`, { method: 'GET' }, timeoutMs);
    return res.ok;
  } catch {
    return false;
  }
}

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

let modelIndexCache = {
  updatedAt: 0,
  instances: [],
  // model name -> instance
  modelToInstance: new Map(),
  // instanceId -> models[]
  modelsByInstance: new Map(),
};

export async function refreshOllamaModelIndex({ force = false } = {}) {
  const CACHE_TTL_MS = 5_000;
  const now = Date.now();
  if (!force && (now - modelIndexCache.updatedAt) < CACHE_TTL_MS) {
    return modelIndexCache;
  }

  const instances = await getOllamaInstances();

  const fetchTags = async (inst) => {
    try {
      const res = await fetchWithTimeout(`${inst.baseUrl}/api/tags`, { method: 'GET' }, 2000);
      if (!res.ok) {
        throw new Error(`Ollama tags failed (${inst.baseUrl}): ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      return Array.isArray(data.models) ? data.models : [];
    } catch (err) {
      logger.warn(`Failed to fetch tags from ${inst.baseUrl}: ${err?.message || err}`);
      return [];
    }
  };

  const tagsByInstance = await Promise.all(instances.map(async (inst) => ({
    inst,
    models: await fetchTags(inst),
  })));

  const modelToInstance = new Map();
  const modelsByInstance = new Map();

  for (const { inst, models } of tagsByInstance) {
    modelsByInstance.set(inst.id, models);
    for (const m of models) {
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

