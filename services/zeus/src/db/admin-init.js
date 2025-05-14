import pool from './conf.js';
import logger from '../utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

async function initializeAdminSchema() {
  const client = await pool.connect();
  
  try {
    logger.info('Initializing admin schema...');
    
    // Создаем схему admin, если она не существует
    await client.query(`CREATE SCHEMA IF NOT EXISTS admin`);
    
    // Создаем таблицу projects, если она не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin.projects (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        embedding_model TEXT NOT NULL,
        creator_email TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Создаем индекс для поиска проектов по имени
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_name
      ON admin.projects (name)
    `);
    
    // Модифицируем таблицу проектов в схеме public для обратной совместимости
    // Создаем таблицу projects, если она еще не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        embedding_model TEXT NOT NULL,
        creator_email TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    logger.info('Admin schema initialized successfully');
  } catch (error) {
    logger.error('Error initializing admin schema:', error);
    throw error;
  } finally {
    client.release();
  }
}

export default initializeAdminSchema; 