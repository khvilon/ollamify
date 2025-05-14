import pool from './conf.js';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';
import qdrantClient from './qdrant.js';
import { getEmbeddingDimension } from '../embeddings.js';

dotenv.config();

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;
if (!EMBEDDING_MODEL) {
  throw new Error('EMBEDDING_MODEL environment variable is required');
}

async function createProjectSchema(project, embeddingModel) {
  const client = await pool.connect();
  try {
    logger.info(`Creating schema for project ${project} with embedding model ${embeddingModel}`);
    
    // Create vector extension if not exists
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');

    // Create schema if not exists
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${project}"`);
    logger.info(`Created schema for project ${project}`);

    // Create documents table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${project}".documents (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        external_id TEXT,
        total_chunks INTEGER NOT NULL,
        loaded_chunks INTEGER NOT NULL DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    logger.info(`Created documents table for project ${project}`);

    // Создаем индекс для external_id
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_external_id
      ON "${project}".documents (external_id)
      WHERE external_id IS NOT NULL
    `);
    logger.info(`Created index for external_id`);

    // Создаем коллекцию в Qdrant, если она не существует
    try {
      const collectionExists = await qdrantClient.collectionExists(project);
      
      if (!collectionExists) {
        logger.info(`Qdrant collection for ${project} doesn't exist, will create it`);
        
        // Получаем размерность для модели эмбеддинга
        let dimension;
        try {
          logger.info(`Getting embedding dimension for model ${embeddingModel}`);
          dimension = await getEmbeddingDimension(embeddingModel);
          logger.info(`Got embedding dimension: ${dimension} for model ${embeddingModel}`);
          
          if (!dimension || dimension <= 0) {
            logger.error(`Invalid dimension ${dimension} for model ${embeddingModel}, using default 1536`);
            dimension = 1536; // Используем размерность по умолчанию если не смогли получить
          }
        } catch (dimensionError) {
          logger.error(`Error getting embedding dimension for ${embeddingModel}:`, dimensionError);
          // Используем безопасное значение по умолчанию
          dimension = 1536;
          logger.info(`Using fallback dimension 1536 after error`);
        }
        
        // Создаем коллекцию с полученной или дефолтной размерностью
        try {
          logger.info(`Creating Qdrant collection for project ${project} with dimension ${dimension}`);
          await qdrantClient.createCollection(project, dimension);
          logger.info(`Successfully created Qdrant collection for project ${project}`);
        } catch (collectionError) {
          logger.error(`Failed to create Qdrant collection for project ${project}:`, collectionError);
          throw new Error(`Failed to create Qdrant collection: ${collectionError.message}`);
        }
      } else {
        logger.info(`Qdrant collection for project ${project} already exists`);
      }
    } catch (error) {
      logger.error(`Error working with Qdrant for project ${project}:`, error);
      throw new Error(`Qdrant error: ${error.message}`);
    }

    logger.info(`Project schema "${project}" initialized successfully`);
  } catch (error) {
    logger.error(`Error initializing project schema "${project}":`, error);
    throw error;
  } finally {
    client.release();
  }
}

export { createProjectSchema };
