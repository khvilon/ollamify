import pool from './conf.js';
import qdrantClient from './qdrant.js';
import logger from '../utils/logger.js';
import { getEmbedding } from '../embeddings.js';

// Функция для миграции чанков из PostgreSQL в Qdrant
export async function migrateChunksToQdrant(projectName) {
  logger.info(`Starting migration of chunks for project ${projectName} from PostgreSQL to Qdrant`);
  
  try {
    // Проверяем существование схемы проекта в PostgreSQL
    const schemaExists = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = $1
    `, [projectName]);
    
    if (schemaExists.rows.length === 0) {
      logger.error(`Project schema ${projectName} does not exist in PostgreSQL`);
      return { 
        success: false, 
        error: `Project schema ${projectName} does not exist in PostgreSQL`
      };
    }
    
    // Проверяем существование таблицы chunks
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 
        AND table_name = 'chunks'
      )
    `, [projectName]);
    
    if (!tableExists.rows[0].exists) {
      logger.error(`Chunks table does not exist in project ${projectName}`);
      return { 
        success: false, 
        error: `Chunks table does not exist in project ${projectName}`
      };
    }
    
    // Проверяем существование коллекции в Qdrant
    const collectionExists = await qdrantClient.collectionExists(projectName);
    if (!collectionExists) {
      logger.error(`Qdrant collection for project ${projectName} does not exist`);
      return { 
        success: false, 
        error: `Qdrant collection for project ${projectName} does not exist`
      };
    }
    
    // Получаем информацию о документах
    const documents = await pool.query(`
      SELECT id, name 
      FROM "${projectName}".documents
    `);
    
    if (documents.rows.length === 0) {
      logger.info(`No documents found in project ${projectName}`);
      return { 
        success: true, 
        message: `No documents found in project ${projectName}`,
        migrated: 0
      };
    }
    
    logger.info(`Found ${documents.rows.length} documents in project ${projectName}`);
    
    // Для каждого документа получаем все чанки и мигрируем их в Qdrant
    let totalMigratedChunks = 0;
    
    for (const document of documents.rows) {
      const documentId = document.id;
      const documentName = document.name;
      
      // Получаем все чанки документа
      const chunks = await pool.query(`
        SELECT chunk_index, content, embedding
        FROM "${projectName}".chunks
        WHERE document_id = $1
        ORDER BY chunk_index
      `, [documentId]);
      
      if (chunks.rows.length === 0) {
        logger.info(`No chunks found for document ${documentId} in project ${projectName}`);
        continue;
      }
      
      logger.info(`Migrating ${chunks.rows.length} chunks for document ${documentId}`);
      
      // Готовим точки для вставки в Qdrant
      const points = [];
      
      for (const chunk of chunks.rows) {
        // Преобразуем эмбеддинг из формата PostgreSQL в обычный массив
        const embeddingString = chunk.embedding.replace('[', '').replace(']', '');
        const embedding = embeddingString.split(',').map(Number);
        
        // Создаем уникальный числовой ID, объединяя documentId и chunk_index
        const numericId = documentId * 1000000 + chunk.chunk_index;
        
        // Формируем точку для Qdrant
        points.push({
          id: numericId, // Используем числовой ID вместо строкового
          vector: embedding,
          payload: {
            document_id: documentId,
            chunk_index: chunk.chunk_index,
            content: chunk.content,
            filename: documentName,
            project: projectName,
            created_at: new Date().toISOString()
          }
        });
      }
      
      // Вставляем точки в Qdrant
      await qdrantClient.upsertPoints(projectName, points);
      totalMigratedChunks += points.length;
    }
    
    logger.info(`Successfully migrated ${totalMigratedChunks} chunks for project ${projectName}`);
    
    return {
      success: true,
      migrated: totalMigratedChunks,
      project: projectName
    };
  } catch (error) {
    logger.error(`Error migrating chunks for project ${projectName}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Функция для миграции всех проектов
export async function migrateAllProjectsToQdrant() {
  logger.info('Starting migration of all projects from PostgreSQL to Qdrant');
  
  try {
    // Получаем список всех проектов
    const { rows } = await pool.query(`
      SELECT name FROM admin.projects
    `);
    
    if (rows.length === 0) {
      logger.info('No projects found in PostgreSQL database');
      return {
        success: true,
        message: 'No projects found in PostgreSQL database',
        results: []
      };
    }
    
    logger.info(`Found ${rows.length} projects in PostgreSQL database`);
    
    // Мигрируем каждый проект
    const results = [];
    
    for (const project of rows) {
      const projectName = project.name;
      
      logger.info(`Migrating project ${projectName}`);
      const result = await migrateChunksToQdrant(projectName);
      
      results.push({
        project: projectName,
        ...result
      });
    }
    
    logger.info('Migration of all projects completed');
    
    return {
      success: true,
      results
    };
  } catch (error) {
    logger.error('Error migrating all projects:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

export default {
  migrateChunksToQdrant,
  migrateAllProjectsToQdrant
}; 