import express from 'express';
import ProjectQueries from '../db/projects.js';
import { asyncHandler } from '../errors.js';

const router = express.Router();

// Получение списка проектов
router.get('/', asyncHandler(async (req, res) => {
  const projects = await ProjectQueries.findAll();
  res.json(projects);
}));

// Получение проекта по ID
router.get('/:id', asyncHandler(async (req, res) => {
  const project = await ProjectQueries.findById(req.params.id);
  if (!project) {
    return res.status(404).json({ 
      error: 'Project not found',
      code: 'PROJECT_NOT_FOUND'
    });
  }
  res.json(project);
}));

// Создание нового проекта
router.post('/', asyncHandler(async (req, res) => {
  const { name, embeddingModel } = req.body;
  const userId = req.user?.id;

  if (!name || !embeddingModel) {
    return res.status(400).json({
      error: 'Name and embedding model are required',
      code: 'MISSING_REQUIRED_FIELDS'
    });
  }

  const project = await ProjectQueries.create(name, embeddingModel, userId);
  res.status(201).json(project);
}));

// Обновление проекта
router.put('/:id', asyncHandler(async (req, res) => {
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({
      error: 'Name is required',
      code: 'MISSING_REQUIRED_FIELDS'
    });
  }

  const project = await ProjectQueries.update(req.params.id, name);
  if (!project) {
    return res.status(404).json({ 
      error: 'Project not found',
      code: 'PROJECT_NOT_FOUND'
    });
  }
  res.json(project);
}));

// Удаление проекта
router.delete('/:id', asyncHandler(async (req, res) => {
  try {
    await ProjectQueries.delete(req.params.id);
    res.status(204).end();
  } catch (error) {
    if (error.message === 'Project not found') {
      return res.status(404).json({ 
        error: 'Project not found',
        code: 'PROJECT_NOT_FOUND'
      });
    }
    throw error;
  }
}));

// Получение статистики проекта
router.get('/:id/stats', asyncHandler(async (req, res) => {
  const project = await ProjectQueries.findById(req.params.id);
  if (!project) {
    return res.status(404).json({ 
      error: 'Project not found',
      code: 'PROJECT_NOT_FOUND'
    });
  }

  const stats = await ProjectQueries.getStats(project.name);
  res.json(stats);
}));

export default router;
