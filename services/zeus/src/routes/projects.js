import express from 'express';
import pool from '../db/conf.js';
import logger from '../utils/logger.js';
import { broadcastProjectUpdate, broadcastProjectStatsUpdate } from '../websocket/index.js';
import ProjectQueries from '../db/projects.js';
import { assertValidProjectName, quoteIdentifier } from '../utils/projectNames.js';

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
    const projects = await ProjectQueries.findAll();
    res.json(projects);
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
 *               description:
 *                 type: string
 *                 description: Project description for humans and external agents
 *                 maxLength: 4000
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
  const { name, embeddingModel, description } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  if (!embeddingModel) {
    return res.status(400).json({ error: 'Embedding model is required' });
  }
  
  try {
    const project = await ProjectQueries.create(
      name,
      embeddingModel,
      req.user?.id || null,
      description
    );

    // Отправляем уведомление через WebSocket
    broadcastProjectUpdate(project);
    
    // Отправляем статистику проекта
    broadcastProjectStatsUpdate(project.id, { document_count: 0 });
    
    res.status(201).json(project);
  } catch (error) {
    logger.error('Error creating project:', error);
    if (error.code === 'INVALID_PROJECT_NAME' || error.code === 'INVALID_PROJECT_DESCRIPTION') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /projects/{id}:
 *   put:
 *     tags: [Projects]
 *     summary: Update a project
 *     description: Update project metadata. Renaming is not supported because project names map to PostgreSQL schemas and Qdrant collections.
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: Project ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: Existing project name. Must not be changed.
 *               description:
 *                 type: string
 *                 description: Project description for humans and external agents
 *                 maxLength: 4000
 *     responses:
 *       200:
 *         description: Project updated successfully
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
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  try {
    const project = await ProjectQueries.update(id, { name, description });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    broadcastProjectUpdate(project);
    res.json(project);
  } catch (error) {
    logger.error('Error updating project:', error);
    if (
      error.code === 'INVALID_PROJECT_NAME' ||
      error.code === 'INVALID_PROJECT_DESCRIPTION' ||
      error.code === 'PROJECT_RENAME_UNSUPPORTED'
    ) {
      return res.status(400).json({ error: error.message });
    }
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
    
    // Используем ProjectQueries для полного удаления проекта
    await ProjectQueries.delete(id);
    
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
    const projectIdentifier = quoteIdentifier(project.name);
    
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
      SELECT COUNT(*) as document_count FROM ${projectIdentifier}.documents
    `);
    
    const stats = {
      document_count: parseInt(documentCount.rows[0].document_count)
    };
    
    // Отправляем статистику через WebSocket
    broadcastProjectStatsUpdate(id, stats);
    
  res.json(stats);
  } catch (error) {
    logger.error('Error getting project stats:', error);
    if (error.code === 'INVALID_PROJECT_NAME') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

export default router;
