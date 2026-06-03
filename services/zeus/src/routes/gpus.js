import express from 'express';
import logger from '../utils/logger.js';
import { getOllamaInstances, refreshOllamaModelIndex } from '../utils/ollama.js';
import { getGpuMetrics } from '../utils/gpuMetrics.js';
import { getProviderLimitSnapshots } from '../utils/providerLimits.js';
import {
  buildVllmModelOptionsFromOllamaIndex,
  getVllmStatus,
  loadVllmModel,
  unloadVllmModel
} from '../utils/vllm.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const instances = await getOllamaInstances();
    const { gpus, metricsAvailable, metricsStale, metricsUpdatedAt } = await getGpuMetrics();
    const vllm = await getVllmStatus();

    res.json({
      instances,
      vllm,
      limits: getProviderLimitSnapshots(),
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

router.get('/vllm/status', async (req, res) => {
  try {
    res.json(await getVllmStatus({ force: true }));
  } catch (error) {
    logger.error('Error fetching vLLM status:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch vLLM status' });
  }
});

router.get('/vllm/models', async (req, res) => {
  try {
    const idx = await refreshOllamaModelIndex({ force: true });
    res.json({ models: buildVllmModelOptionsFromOllamaIndex(idx) });
  } catch (error) {
    logger.error('Error fetching vLLM model options:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch vLLM model options' });
  }
});

router.post('/vllm/load', async (req, res) => {
  try {
    const { model, extra_args = [] } = req.body || {};
    const result = await loadVllmModel({ model, extra_args });
    res.status(202).json(result);
  } catch (error) {
    logger.error('Error loading vLLM model:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to load vLLM model' });
  }
});

router.post('/vllm/unload', async (req, res) => {
  try {
    res.json(await unloadVllmModel());
  } catch (error) {
    logger.error('Error unloading vLLM model:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to unload vLLM model' });
  }
});

export default router;

