import express from 'express';
import { migrateChunksToQdrant, migrateAllProjectsToQdrant } from '../db/migrate-to-qdrant.js';
import pool from '../db/conf.js';
import logger from '../utils/logger.js';
import FriendlyServerQueries from '../db/friendly-servers.js';
import { fetchRemoteClusterStatus } from '../utils/clusterStatus.js';

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

// Эндпоинт для получения логов запросов
router.get('/logs', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      user_name, 
      start_date, 
      end_date,
      method,
      path 
    } = req.query;
    
    const offset = (page - 1) * limit;
    
    let whereConditions = [];
    let params = [];
    let paramIndex = 1;
    
    // Если пользователь не админ, показываем только его логи
    const isAdmin = req.user && req.user.is_admin;
    if (!isAdmin && req.user && req.user.username) {
      whereConditions.push(`user_name = $${paramIndex}`);
      params.push(req.user.username);
      paramIndex++;
    }
    
    // Фильтр по имени пользователя (только для админов)
    if (user_name && isAdmin) {
      whereConditions.push(`user_name ILIKE $${paramIndex}`);
      params.push(`%${user_name}%`);
      paramIndex++;
    }
    
    // Фильтр по методу запроса
    if (method) {
      whereConditions.push(`request_method = $${paramIndex}`);
      params.push(method.toUpperCase());
      paramIndex++;
    }
    
    // Фильтр по пути запроса
    if (path) {
      whereConditions.push(`request_path ILIKE $${paramIndex}`);
      params.push(`%${path}%`);
      paramIndex++;
    }
    
    // Фильтр по дате начала
    if (start_date) {
      whereConditions.push(`created_at >= $${paramIndex}`);
      params.push(start_date);
      paramIndex++;
    }
    
    // Фильтр по дате окончания
    if (end_date) {
      whereConditions.push(`created_at <= $${paramIndex}`);
      params.push(end_date);
      paramIndex++;
    }
    
    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';
    
    const client = await pool.connect();
    
    try {
      // Получаем общее количество записей
      const countQuery = `
        SELECT COUNT(*) as total
        FROM admin.user_logs
        ${whereClause}
      `;
      
      const countResult = await client.query(countQuery, params);
      const total = parseInt(countResult.rows[0].total);
      
      // Получаем логи с пагинацией
      const logsQuery = `
        SELECT 
          id,
          user_name,
          ${isAdmin ? 'user_key,' : ''}
          ${isAdmin ? 'api_key_name,' : ''}
          request_method,
          request_path,
          ${isAdmin ? 'request_body,' : ''}
          ip_address,
          ${isAdmin ? 'response_body,' : ''}
          response_time,
          model_name,
          request_summary,
          endpoint_category,
          user_text,
          created_at
        FROM admin.user_logs
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      
      params.push(limit, offset);
      
      const logsResult = await client.query(logsQuery, params);
      
      // Статистика
      const statsQuery = `
        SELECT 
          COUNT(*) as total_requests,
          ${isAdmin ? 'COUNT(DISTINCT user_name) as unique_users,' : ''}
          AVG(response_time) as avg_response_time,
          MAX(response_time) as max_response_time,
          COUNT(CASE WHEN response_time > 1000 THEN 1 END) as slow_requests
        FROM admin.user_logs
        ${whereClause}
      `;
      
      const statsResult = await client.query(statsQuery, params.slice(0, -2)); // Убираем LIMIT и OFFSET
      
      res.json({
        logs: logsResult.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        },
        stats: statsResult.rows[0],
        isAdmin
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    logger.error('Error fetching logs:', error);
    res.status(500).json({
      error: 'Failed to fetch logs',
      details: error.message
    });
  }
});

// Эндпоинт для получения статистики использования по пользователям
router.get('/stats/users', async (req, res) => {
  try {
    // Только админы могут видеть статистику всех пользователей
    if (!req.user || !req.user.is_admin) {
      return res.status(403).json({
        error: 'Access denied: admin privileges required'
      });
    }
    
    const { start_date, end_date } = req.query;
    
    let whereConditions = [];
    let params = [];
    let paramIndex = 1;
    
    if (start_date) {
      whereConditions.push(`created_at >= $${paramIndex}`);
      params.push(start_date);
      paramIndex++;
    }
    
    if (end_date) {
      whereConditions.push(`created_at <= $${paramIndex}`);
      params.push(end_date);
      paramIndex++;
    }
    
    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';
    
    const client = await pool.connect();
    
    try {
      const query = `
        SELECT 
          user_name,
          COUNT(*) as request_count,
          AVG(response_time) as avg_response_time,
          MAX(response_time) as max_response_time,
          MIN(created_at) as first_request,
          MAX(created_at) as last_request,
          COUNT(DISTINCT DATE(created_at)) as active_days,
          COUNT(DISTINCT model_name) as unique_models,
          COUNT(DISTINCT endpoint_category) as categories_used,
          mode() WITHIN GROUP (ORDER BY endpoint_category) as most_used_category,
          mode() WITHIN GROUP (ORDER BY model_name) as most_used_model
        FROM admin.user_logs
        ${whereClause}
        GROUP BY user_name
        ORDER BY request_count DESC
      `;
      
      const result = await client.query(query, params);
      
      res.json({
        users: result.rows
      });
      
    } finally {
      client.release();
    }
    
  } catch (error) {
    logger.error('Error fetching user stats:', error);
    res.status(500).json({
      error: 'Failed to fetch user statistics',
      details: error.message
    });
  }
});

// ---- Friendly servers (cluster peers) CRUD (admin only) ----

router.get('/friendly-servers', requireAdmin, async (req, res) => {
  try {
    const servers = await FriendlyServerQueries.list({ includeSecrets: false });
    res.json({ servers });
  } catch (error) {
    logger.error('Error listing friendly servers:', error);
    res.status(500).json({ error: error.message || 'Failed to list friendly servers' });
  }
});

router.post('/friendly-servers', requireAdmin, async (req, res) => {
  try {
    const { name, base_url, username, api_key, enabled = true } = req.body || {};
    const created = await FriendlyServerQueries.create({ name, base_url, username, api_key, enabled });
    res.status(201).json({ server: created });
  } catch (error) {
    logger.error('Error creating friendly server:', error);
    res.status(400).json({ error: error.message || 'Failed to create friendly server' });
  }
});

router.put('/friendly-servers/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};
    const updated = await FriendlyServerQueries.update(id, {
      name: payload.name,
      base_url: payload.base_url,
      username: payload.username,
      api_key: payload.api_key,
      enabled: payload.enabled,
    });
    if (!updated) {
      return res.status(404).json({ error: 'Friendly server not found' });
    }
    res.json({ server: updated });
  } catch (error) {
    logger.error('Error updating friendly server:', error);
    res.status(400).json({ error: error.message || 'Failed to update friendly server' });
  }
});

router.delete('/friendly-servers/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await FriendlyServerQueries.delete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Friendly server not found' });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting friendly server:', error);
    res.status(500).json({ error: error.message || 'Failed to delete friendly server' });
  }
});

router.get('/friendly-servers/:id/status', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const server = await FriendlyServerQueries.findById(id, { includeSecrets: true });
    if (!server) {
      return res.status(404).json({ error: 'Friendly server not found' });
    }

    const status = await fetchRemoteClusterStatus(server, { force: true, timeoutMs: 5000 });
    res.json({ status });
  } catch (error) {
    logger.error('Error fetching friendly server status:', error);
    res.status(502).json({ error: error.message || 'Failed to fetch friendly server status' });
  }
});

export default router; 