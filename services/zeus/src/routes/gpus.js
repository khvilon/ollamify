import express from 'express';
import logger from '../utils/logger.js';
import { getOllamaInstances } from '../utils/ollama.js';
import { getGpuMetrics } from '../utils/gpuMetrics.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const instances = await getOllamaInstances();
    const { gpus, metricsAvailable, metricsStale, metricsUpdatedAt } = await getGpuMetrics();

    res.json({
      instances,
      gpus,
      metricsAvailable,
      metricsStale,
      metricsUpdatedAt
    });
  } catch (error) {
    logger.error('Error fetching GPU info:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch GPU info' });
  }
});

export default router;

