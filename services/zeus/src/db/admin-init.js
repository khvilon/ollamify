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

    await client.query(`ALTER TABLE admin.projects ADD COLUMN IF NOT EXISTS created_by INTEGER`);
    await client.query(`ALTER TABLE admin.projects ADD COLUMN IF NOT EXISTS embedding_model TEXT`);
    await client.query(`ALTER TABLE admin.projects ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
    await client.query(`
      UPDATE admin.projects
      SET embedding_model = 'frida'
      WHERE embedding_model IS NULL OR embedding_model = ''
    `);
    await client.query(`
      UPDATE admin.projects
      SET created_at = CURRENT_TIMESTAMP
      WHERE created_at IS NULL
    `);
    await client.query(`ALTER TABLE admin.projects ALTER COLUMN embedding_model SET NOT NULL`);
    await client.query(`ALTER TABLE admin.projects ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP`);
    
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS admin.api_keys (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        key_value TEXT UNIQUE NOT NULL,
        user_id INTEGER REFERENCES admin.users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS api_keys_user_id_idx
      ON admin.api_keys (user_id)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS admin.user_logs (
        id SERIAL PRIMARY KEY,
        user_name TEXT,
        user_key TEXT,
        api_key_name TEXT,
        request_method TEXT NOT NULL,
        request_path TEXT NOT NULL,
        request_body JSONB,
        ip_address TEXT,
        response_body JSONB,
        response_time INTEGER,
        model_name TEXT,
        request_summary TEXT,
        endpoint_category TEXT,
        user_text TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS user_logs_created_at_idx
      ON admin.user_logs (created_at)
    `);

    await client.query(`ALTER TABLE admin.user_logs ADD COLUMN IF NOT EXISTS api_key_name TEXT`);
    await client.query(`ALTER TABLE admin.user_logs ADD COLUMN IF NOT EXISTS model_name TEXT`);
    await client.query(`ALTER TABLE admin.user_logs ADD COLUMN IF NOT EXISTS request_summary TEXT`);
    await client.query(`ALTER TABLE admin.user_logs ADD COLUMN IF NOT EXISTS endpoint_category TEXT`);
    await client.query(`ALTER TABLE admin.user_logs ADD COLUMN IF NOT EXISTS user_text TEXT`);

    // Friendly Ollamify servers (cluster peers)
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin.friendly_servers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT UNIQUE NOT NULL,
        username TEXT,
        api_key TEXT NOT NULL,
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_friendly_servers_enabled
      ON admin.friendly_servers (enabled)
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
