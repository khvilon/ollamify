import express from 'express';
import pool from '../db/conf.js';
import { createProjectSchema } from '../db/init.js';
import logger from '../utils/logger.js';
import { broadcastProjectUpdate, broadcastProjectStatsUpdate } from '../websocket/index.js';

const router = express.Router();

/**
 * @swagger
 * /projects:
 *   get:
 *     tags: [Projects]
 *     summary: Get all projects
 *     description: Retrieve a list of all projects
 *     responses:
 *       200:
 *         description: A list of projects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Project'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM admin.projects ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    logger.error('Error fetching projects:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /projects:
 *   post:
 *     tags: [Projects]
 *     summary: Create a new project
 *     description: Create a new project with the given name
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Project name
 *               embeddingModel:
 *                 type: string
 *                 description: Name of embedding model to use
 *     responses:
 *       201:
 *         description: Project created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Project'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', async (req, res) => {
  const { name, embeddingModel } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Project name is required' });
  }
  
  if (!embeddingModel) {
    return res.status(400).json({ error: 'Embedding model is required' });
  }
  
  try {
    const result = await pool.query(
      'INSERT INTO admin.projects (name, embedding_model) VALUES ($1, $2) RETURNING *',
      [name, embeddingModel]
    );
    
    const project = result.rows[0];
    
    // Создаем схему для проекта
    await createProjectSchema(name, embeddingModel);
    
    // Отправляем уведомление через WebSocket
    broadcastProjectUpdate(project);
    
    // Отправляем статистику проекта
    broadcastProjectStatsUpdate(project.id, { document_count: 0 });
    
    res.status(201).json(project);
  } catch (error) {
    logger.error('Error creating project:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /projects/{id}:
 *   delete:
 *     tags: [Projects]
 *     summary: Delete a project
 *     description: Delete a project by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: Project ID
 *     responses:
 *       200:
 *         description: Project deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       404:
 *         description: Project not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Получаем информацию о проекте перед удалением
    const projectInfo = await pool.query('SELECT * FROM admin.projects WHERE id = $1', [id]);
    
    if (projectInfo.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const project = projectInfo.rows[0];
    
    // Удаляем схему проекта
    await pool.query(`DROP SCHEMA IF EXISTS "${project.name}" CASCADE`);
    
    // Удаляем запись из таблицы проектов
    await pool.query('DELETE FROM admin.projects WHERE id = $1', [id]);
    
    // Отправляем уведомление через WebSocket
    broadcastProjectUpdate({ ...project, deleted: true });
    
    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    logger.error('Error deleting project:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /projects/{id}/stats:
 *   get:
 *     tags: [Projects]
 *     summary: Get project statistics
 *     description: Get statistics for a project by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: Project ID
 *     responses:
 *       200:
 *         description: Project statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 document_count:
 *                   type: integer
 *                   description: Number of documents in the project
 *       404:
 *         description: Project not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:id/stats', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Получаем информацию о проекте
    const projectInfo = await pool.query('SELECT * FROM admin.projects WHERE id = $1', [id]);
    
    if (projectInfo.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const project = projectInfo.rows[0];
    
    // Проверяем существование схемы
    const schemaExists = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.schemata WHERE schema_name = $1
      )
    `, [project.name]);
    
    if (!schemaExists.rows[0].exists) {
      return res.json({ document_count: 0 });
    }
    
    // Проверяем существование таблицы документов
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'documents'
      )
    `, [project.name]);
    
    if (!tableExists.rows[0].exists) {
      return res.json({ document_count: 0 });
    }
    
    // Получаем количество документов
    const documentCount = await pool.query(`
      SELECT COUNT(*) as document_count FROM "${project.name}".documents
    `);
    
    const stats = {
      document_count: parseInt(documentCount.rows[0].document_count)
    };
    
    // Отправляем статистику через WebSocket
    broadcastProjectStatsUpdate(id, stats);
    
    res.json(stats);
  } catch (error) {
    logger.error('Error getting project stats:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
