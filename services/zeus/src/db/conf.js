import pg from 'pg';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const pool = new pg.Pool({
  user: process.env.POSTGRES_USER,
  host: process.env.POSTGRES_HOST,
  database: process.env.POSTGRES_DB,
  password: process.env.POSTGRES_PASSWORD,
  port: process.env.POSTGRES_PORT,
  max: 20, // максимальное количество клиентов в пуле
});

pool.on('connect', () => {
  logger.info('New client connected to pool');
});

pool.on('remove', () => {
  logger.info('Client removed from pool');
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
});

export default pool;
