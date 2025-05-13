import qdrantClient from './qdrant.js';
import pool from './conf.js';
import logger from '../utils/logger.js';
import { getEmbeddingDimension } from '../embeddings.js';

// Функция для инициализации коллекций Qdrant на основе существующих проектов
export async function initializeQdrantCollections() {
  try {
    logger.info('Starting Qdrant collections initialization');
    
    // Проверяем состояние Qdrant
    try {
      const health = await qdrantClient.healthCheck();
      logger.info('Qdrant health check:', health);
    } catch (error) {
      logger.error('Qdrant health check failed:', error);
      logger.error('Cannot proceed with initialization - please check Qdrant service');
      return;
    }
    
    // Получаем список всех проектов из PostgreSQL
    const { rows } = await pool.query(`
      SELECT name, embedding_model 
      FROM admin.projects 
      ORDER BY created_at
    `);
    
    if (rows.length === 0) {
      logger.info('No projects found in PostgreSQL database');
      return;
    }
    
    logger.info(`Found ${rows.length} projects in PostgreSQL database`);
    
    // Получаем список существующих коллекций в Qdrant
    const collections = await qdrantClient.listCollections();
    const existingCollections = collections.map(c => c.name);
    
    logger.info(`Existing Qdrant collections: ${existingCollections.join(', ') || 'none'}`);
    
    // Создаем коллекции для каждого проекта, если они еще не существуют
    for (const project of rows) {
      const projectName = project.name;
      const embeddingModel = project.embedding_model;
      
      if (existingCollections.includes(projectName)) {
        logger.info(`Collection for project ${projectName} already exists in Qdrant`);
        continue;
      }
      
      try {
        // Получаем размерность эмбеддингов для модели проекта
        const dimension = await getEmbeddingDimension(embeddingModel);
        
        // Создаем коллекцию
        logger.info(`Creating collection for project ${projectName} with dimension ${dimension}`);
        await qdrantClient.createCollection(projectName, dimension);
        
        logger.info(`Collection for project ${projectName} created successfully`);
      } catch (error) {
        logger.error(`Error creating collection for project ${projectName}:`, error);
      }
    }
    
    logger.info('Qdrant collections initialization completed');
  } catch (error) {
    logger.error('Error initializing Qdrant collections:', error);
  }
}

// Экспортируем функцию для использования в приложении
export default initializeQdrantCollections; 