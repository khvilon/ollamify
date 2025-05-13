import pool from './conf.js';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';
import qdrantClient from './qdrant.js';

dotenv.config();

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;
if (!EMBEDDING_MODEL) {
  throw new Error('EMBEDDING_MODEL environment variable is required');
}

async function createProjectSchema(project, dimension) {
  const client = await pool.connect();
  try {
    logger.info(`Using embedding dimension ${dimension} for model ${EMBEDDING_MODEL}`);

    // Create vector extension if not exists
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');

    logger.info(`Creating schema for project ${project} with embedding dimension ${dimension}`);
    
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
        logger.info(`Creating Qdrant collection for project ${project}`);
        await qdrantClient.createCollection(project, dimension);
        logger.info(`Created Qdrant collection for project ${project}`);
      } else {
        logger.info(`Qdrant collection for project ${project} already exists`);
      }
    } catch (error) {
      logger.error(`Error creating Qdrant collection for project ${project}:`, error);
      // Не блокируем создание проекта, если не удалось создать коллекцию
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
