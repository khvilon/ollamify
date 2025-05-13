import express from 'express';
import { migrateChunksToQdrant, migrateAllProjectsToQdrant } from '../db/migrate-to-qdrant.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Middleware для проверки прав администратора
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({
      error: 'Forbidden: this action requires admin privileges'
    });
  }
  next();
}

// Эндпоинт для миграции одного проекта на Qdrant
router.post('/migrate/:project', requireAdmin, async (req, res) => {
  const { project } = req.params;
  
  if (!project) {
    return res.status(400).json({
      error: 'Project name is required'
    });
  }
  
  try {
    logger.info(`Received request to migrate project ${project} to Qdrant`);
    
    const result = await migrateChunksToQdrant(project);
    
    if (!result.success) {
      logger.error(`Migration of project ${project} failed:`, result.error);
      return res.status(500).json({
        error: 'Migration failed',
        details: result.error
      });
    }
    
    logger.info(`Migration of project ${project} completed successfully`);
    res.json(result);
  } catch (error) {
    logger.error(`Error migrating project ${project}:`, error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Эндпоинт для миграции всех проектов на Qdrant
router.post('/migrate-all', requireAdmin, async (req, res) => {
  try {
    logger.info('Received request to migrate all projects to Qdrant');
    
    const result = await migrateAllProjectsToQdrant();
    
    if (!result.success) {
      logger.error('Migration of all projects failed:', result.error);
      return res.status(500).json({
        error: 'Migration failed',
        details: result.error
      });
    }
    
    logger.info('Migration of all projects completed successfully');
    res.json(result);
  } catch (error) {
    logger.error('Error migrating all projects:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

export default router; 