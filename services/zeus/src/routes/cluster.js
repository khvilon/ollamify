import express from 'express';
import logger from '../utils/logger.js';
import { getLocalClusterStatus } from '../utils/clusterStatus.js';

const router = express.Router();

// Local node status: used by friendly routing and UI diagnostics
router.get('/status', async (req, res) => {
  try {
    const status = await getLocalClusterStatus();
    res.json(status);
  } catch (error) {
    logger.error('Error building cluster status:', error);
    res.status(500).json({ error: error.message || 'Failed to build cluster status' });
  }
});

export default router;

