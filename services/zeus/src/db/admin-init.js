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
        created_by INTEGER,
        embedding_model TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Создаем индекс для поиска проектов по имени
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_name
      ON admin.projects (name)
    `);
    
    // Создаем таблицу users, если она не существует
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin.users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin BOOLEAN DEFAULT false,
        api_keys JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Создаем дефолтного админа, если его нет
    await client.query(`
      INSERT INTO admin.users (username, email, password_hash, is_admin)
      SELECT 'admin', 'admin@example.com', '$2b$10$c0zWIHFrB1MpYcdBkTPkYOY1F3jPUddZ2LzApfaXT4.BcXVqX/L6G', true
      WHERE NOT EXISTS (
        SELECT 1 FROM admin.users WHERE is_admin = true
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