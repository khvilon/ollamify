import express from 'express';
import logger from '../utils/logger.js';
import { fetchWithTimeout, getOllamaInstances } from '../utils/ollama.js';

const router = express.Router();

const GPU_INFO_URL = process.env.GPU_INFO_URL || 'http://gpu-info:8005';

let lastGpuSnapshot = {
  gpus: [],
  updatedAt: 0,
};

let lastWarnAt = 0;

router.get('/', async (req, res) => {
  try {
    const instances = await getOllamaInstances();

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

    res.json({
      instances,
      gpus,
      metricsAvailable,
      metricsStale,
      metricsUpdatedAt: lastGpuSnapshot.updatedAt || null
    });
  } catch (error) {
    logger.error('Error fetching GPU info:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch GPU info' });
  }
});

export default router;

