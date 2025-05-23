import express from 'express';
import { UserQueries } from '../db/users.js';
import { asyncHandler } from '../errors.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import pool from '../db/conf.js';

const router = express.Router();
const saltRounds = 10;

const hashPassword = async (password) => {
  return await bcrypt.hash(password, saltRounds);
};

const generateApiKey = () => {
  return crypto.randomBytes(32)
    .toString('hex');
};

// Users CRUD
router.get('/', asyncHandler(async (req, res) => {
  const users = await UserQueries.findAll();
  res.json(users);
}));

// Profile endpoint - returns current user data with statistics
router.get('/profile', asyncHandler(async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  // Ensure userId is a number
  const userId = parseInt(req.user.id);
  if (isNaN(userId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  try {
    // Get user basic info
    const user = await UserQueries.findById(userId);

    // Get user statistics
    const { rows: statsRows } = await pool.query(`
      SELECT 
        -- Documents count
        (SELECT COUNT(*) FROM admin.projects WHERE created_by = $1) as projects_count,
        -- API keys count  
        (SELECT COUNT(*) FROM admin.api_keys WHERE user_id = $1) as api_keys_count,
        -- Request logs count (last 30 days)
        (SELECT COUNT(*) FROM admin.user_logs 
         WHERE user_name = $2 AND created_at > NOW() - INTERVAL '30 days') as requests_last_month,
        -- Total request logs
        (SELECT COUNT(*) FROM admin.user_logs WHERE user_name = $2) as total_requests,
        -- Last login from logs
        (SELECT MAX(created_at) FROM admin.user_logs WHERE user_name = $2) as last_activity
    `, [userId, user.username || user.email]);

    const stats = statsRows[0];

    // Get recent activity (last 10 requests)
    const { rows: activityRows } = await pool.query(`
      SELECT request_method, request_path, created_at, response_time
      FROM admin.user_logs 
      WHERE user_name = $1 
      ORDER BY created_at DESC 
      LIMIT 10
    `, [user.username || user.email]);

    // Calculate storage usage estimate (rough calculation)
    const { rows: storageRows } = await pool.query(`
      SELECT 
        COALESCE(SUM(pg_column_size(request_body) + pg_column_size(response_body)), 0) as logs_size
      FROM admin.user_logs 
      WHERE user_name = $1
    `, [user.username || user.email]);

    const storageUsed = Math.round(storageRows[0].logs_size / 1024 / 1024 * 100) / 100; // MB

    const profileData = {
      ...user,
      statistics: {
        projects_count: parseInt(stats.projects_count) || 0,
        api_keys_count: parseInt(stats.api_keys_count) || 0,
        requests_last_month: parseInt(stats.requests_last_month) || 0,
        total_requests: parseInt(stats.total_requests) || 0,
        storage_used_mb: storageUsed,
        last_activity: stats.last_activity
      },
      recent_activity: activityRows
    };
    
    res.json(profileData);
  } catch (error) {
    console.error('Profile endpoint error:', error);
    res.status(500).json({ error: 'Failed to fetch profile data', details: error.message });
  }
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const user = await UserQueries.findById(req.params.id);
  res.json(user);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { email, password, role } = req.body;
  const updateData = {
    ...(email && { email }),
    ...(password && { password_hash: await hashPassword(password) }),
    ...(role && { is_admin: role === 'admin' })
  };
  
  const user = await UserQueries.update(req.params.id, updateData);
  res.json(user);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await UserQueries.deleteById(req.params.id);
  res.status(204).end();
}));

router.post('/', asyncHandler(async (req, res) => {
  const { email, password, role } = req.body;
  const passwordHash = await hashPassword(password);
  const user = await UserQueries.create(email, email, passwordHash, role === 'admin');
  res.status(201).json(user);
}));

// API Keys
router.get('/:userId/api-keys', asyncHandler(async (req, res) => {
  const keys = await UserQueries.findApiKeysByUserId(req.params.userId);
  res.json(keys);
}));

router.post('/:userId/api-keys', asyncHandler(async (req, res) => {
  const { name } = req.body;
  const keyValue = generateApiKey();
  const key = await UserQueries.createApiKey(name, keyValue, req.params.userId);
  res.status(201).json(key);
}));

router.put('/:userId/api-keys/:keyId', asyncHandler(async (req, res) => {
  const { name } = req.body;
  const key = await UserQueries.updateApiKey(req.params.keyId, name, req.params.userId);
  res.json(key);
}));

router.delete('/:userId/api-keys/:keyId', asyncHandler(async (req, res) => {
  await UserQueries.deleteApiKey(req.params.keyId, req.params.userId);
  res.status(204).end();
}));

export default router;
