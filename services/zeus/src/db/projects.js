import pool from './conf.js';
import { createProjectSchema } from './init.js';
import qdrantClient from './qdrant.js';
import logger from '../utils/logger.js';
import { assertValidProjectName, quoteIdentifier } from '../utils/projectNames.js';
import { assertValidProjectDescription } from '../utils/projectDescriptions.js';

class ProjectQueries {
  // Получение всех проектов с информацией о создателе
  async findAll() {
    const { rows } = await pool.query(`
      SELECT p.*, u.email as creator_email, u.username as creator_username
      FROM admin.projects p
      LEFT JOIN admin.users u ON p.created_by = u.id
      ORDER BY p.created_at DESC
    `);
    return rows;
  }

  // Получение проекта по ID
  async findById(id) {
    const { rows } = await pool.query(`
      SELECT p.*, u.email as creator_email, u.username as creator_username
      FROM admin.projects p
      LEFT JOIN admin.users u ON p.created_by = u.id
      WHERE p.id = $1
    `, [id]);
    return rows[0];
  }

  // Создание нового проекта
  async create(name, embeddingModel, userId, description = '') {
    const projectName = assertValidProjectName(name);
    const projectDescription = assertValidProjectDescription(description);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Создаем запись в admin.projects
      const { rows } = await client.query(`
        INSERT INTO admin.projects (name, embedding_model, created_by, description)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [projectName, embeddingModel, userId, projectDescription]);

      // Получаем размерность эмбеддингов и создаем схему проекта
      await createProjectSchema(projectName, embeddingModel);

      await client.query('COMMIT');
      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Обновление проекта
  async update(id, { name, description } = {}) {
    const current = await this.findById(id);
    if (!current) {
      return null;
    }

    const projectName = name === undefined || name === null || name === ''
      ? current.name
      : assertValidProjectName(name);
    if (projectName !== current.name) {
      const error = new Error('Project renaming is not supported yet because project names map to PostgreSQL schemas and Qdrant collections');
      error.code = 'PROJECT_RENAME_UNSUPPORTED';
      throw error;
    }

    const projectDescription = description === undefined
      ? current.description || ''
      : assertValidProjectDescription(description);
    const { rows } = await pool.query(`
      UPDATE admin.projects
      SET description = $1
      WHERE id = $2
      RETURNING *
    `, [projectDescription, id]);
    return rows[0];
  }

  // Удаление проекта
  async delete(id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Получаем имя проекта
      const { rows } = await client.query(`
        SELECT name FROM admin.projects WHERE id = $1
      `, [id]);

      if (rows.length === 0) {
        throw new Error('Project not found');
      }

      const projectName = assertValidProjectName(rows[0].name);
      const projectIdentifier = quoteIdentifier(projectName);

      // Удаляем схему проекта
      await client.query(`DROP SCHEMA IF EXISTS ${projectIdentifier} CASCADE`);
      
      // Удаляем коллекцию в Qdrant
      try {
        const collectionExists = await qdrantClient.collectionExists(projectName);
        if (collectionExists) {
          logger.info(`Deleting Qdrant collection for project ${projectName}`);
          await qdrantClient.deleteCollection(projectName);
          logger.info(`Deleted Qdrant collection for project ${projectName}`);
        } else {
          logger.warn(`Qdrant collection for project ${projectName} does not exist`);
        }
      } catch (error) {
        logger.error(`Error deleting Qdrant collection for project ${projectName}:`, error);
        // Не блокируем удаление проекта, если не удалось удалить коллекцию
      }

      // Удаляем запись из admin.projects
      await client.query(`
        DELETE FROM admin.projects WHERE id = $1
      `, [id]);

      await client.query('COMMIT');
      return { success: true, message: 'Project deleted successfully' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Получение статистики проекта
  async getStats(projectName) {
    const projectIdentifier = quoteIdentifier(projectName);
    const { rows } = await pool.query(`
      SELECT 
        COUNT(*) as document_count,
        SUM(total_chunks) as total_chunks,
        MIN(created_at) as first_document,
        MAX(created_at) as last_document
      FROM ${projectIdentifier}.documents
    `);
    
    // Добавляем информацию о векторной базе
    let qdrantStats = null;
    try {
      const collectionExists = await qdrantClient.collectionExists(projectName);
      if (collectionExists) {
        // Реализация метода получения статистики зависит от версии Qdrant API
        // Обычно нужно получить информацию о количестве точек в коллекции
        // Т.к. у нас клиент не поддерживает это напрямую, просто отмечаем, что коллекция существует
        qdrantStats = { 
          exists: true,
          collection_name: projectName
        };
      }
    } catch (error) {
      logger.error(`Error getting Qdrant stats for project ${projectName}:`, error);
    }
    
    return {
      ...rows[0],
      vector_db: qdrantStats
    };
  }
}

export default new ProjectQueries();
