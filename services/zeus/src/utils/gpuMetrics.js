import logger from './logger.js';
import { fetchWithTimeout } from './ollama.js';

const GPU_INFO_URL = process.env.GPU_INFO_URL || 'http://gpu-info:8005';

let lastGpuSnapshot = {
  gpus: [],
  updatedAt: 0,
};

let lastWarnAt = 0;

export async function getGpuMetrics() {
  let gpus = [];
  let metricsAvailable = false;
  let metricsStale = false;

  try {
    const r = await fetchWithTimeout(`${GPU_INFO_URL}/gpus`, { method: 'GET' }, 3500);
    if (r.ok) {
      const data = await r.json();
      gpus = Array.isArray(data.gpus) ? data.gpus : [];
      metricsAvailable = true;

      // Update cache on success (even if empty array is returned)
      lastGpuSnapshot = { gpus, updatedAt: Date.now() };
    }
  } catch (e) {
    // GPU metrics are optional
    const now = Date.now();
    // Rate-limit warnings to avoid log spam (UI polls frequently)
    if (now - lastWarnAt > 10_000) {
      lastWarnAt = now;
      logger.warn(`GPU metrics not available: ${e?.message || e}`);
    }

    // Fallback to cache for a short window to avoid "flapping" UI
    const CACHE_TTL_MS = 30_000;
    if (lastGpuSnapshot.updatedAt && (now - lastGpuSnapshot.updatedAt) < CACHE_TTL_MS) {
      gpus = lastGpuSnapshot.gpus;
      metricsAvailable = true;
      metricsStale = true;
    }
  }

  return {
    gpus,
    metricsAvailable,
    metricsStale,
    metricsUpdatedAt: lastGpuSnapshot.updatedAt || null,
  };
}

