import pool from './conf.js';
import dotenv from 'dotenv';

dotenv.config();

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;
if (!EMBEDDING_MODEL) {
  throw new Error('EMBEDDING_MODEL environment variable is required');
}

async function createProjectSchema(project, dimension) {
  const client = await pool.connect();
  try {
    console.log(`Using embedding dimension ${dimension} for model ${EMBEDDING_MODEL}`);

    // Create vector extension if not exists
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');

    console.log(`Creating schema for project ${project} with embedding dimension ${dimension}`);
    
    // Create schema if not exists
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${project}"`);
    console.log(`Created schema for project ${project}`);

    // Create documents table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${project}".documents (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        total_chunks INTEGER NOT NULL,
        loaded_chunks INTEGER NOT NULL DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log(`Created documents table for project ${project}`);

    // Create chunks table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${project}".chunks (
        id SERIAL PRIMARY KEY,
        document_id INTEGER REFERENCES "${project}".documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding VECTOR(${dimension}),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(document_id, chunk_index)
      )
    `);
    console.log(`Created chunks table with embedding vector(${dimension})`);

    // Create index on embedding vector with the same dimension
    await client.query(`
      CREATE INDEX IF NOT EXISTS chunks_embedding_idx_${dimension}
      ON "${project}".chunks 
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = ${Math.ceil(dimension / 10)})
    `);
    console.log(`Created index on chunks table for project ${project}`);

    console.log(`Project schema "${project}" initialized successfully`);
  } catch (error) {
    console.error(`Error initializing project schema "${project}":`, error);
    throw error;
  } finally {
    client.release();
  }
}

export { createProjectSchema };
