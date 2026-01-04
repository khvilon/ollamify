import express from 'express';
import logger from '../utils/logger.js';
import { fetchWithTimeout, getOllamaInstances } from '../utils/ollama.js';

const router = express.Router();

const GPU_INFO_URL = process.env.GPU_INFO_URL || 'http://gpu-info:8005';

router.get('/', async (req, res) => {
  try {
    const instances = await getOllamaInstances();

    let gpus = [];
    let metricsAvailable = false;

    try {
      const r = await fetchWithTimeout(`${GPU_INFO_URL}/gpus`, { method: 'GET' }, 1500);
      if (r.ok) {
        const data = await r.json();
        gpus = Array.isArray(data.gpus) ? data.gpus : [];
        metricsAvailable = true;
      }
    } catch (e) {
      // GPU metrics are optional
      logger.warn(`GPU metrics not available: ${e?.message || e}`);
    }

    res.json({
      instances,
      gpus,
      metricsAvailable
    });
  } catch (error) {
    logger.error('Error fetching GPU info:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch GPU info' });
  }
});

export default router;

