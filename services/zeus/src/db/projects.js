import pool from './conf.js';
import { createProjectSchema } from './init.js';
import { getEmbeddingDimension } from '../embeddings.js';

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
  async create(name, embeddingModel, userId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Создаем запись в admin.projects
      const { rows } = await client.query(`
        INSERT INTO admin.projects (name, embedding_model, created_by)
        VALUES ($1, $2, $3)
        RETURNING *
      `, [name, embeddingModel, userId]);

      // Получаем размерность эмбеддингов и создаем схему проекта
      const dimension = await getEmbeddingDimension(embeddingModel);
      await createProjectSchema(name, dimension);

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
  async update(id, name) {
    const { rows } = await pool.query(`
      UPDATE admin.projects
      SET name = $1
      WHERE id = $2
      RETURNING *
    `, [name, id]);
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

      const projectName = rows[0].name;

      // Удаляем схему проекта
      await client.query(`DROP SCHEMA IF EXISTS "${projectName}" CASCADE`);

      // Удаляем запись из admin.projects
      await client.query(`
        DELETE FROM admin.projects WHERE id = $1
      `, [id]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Получение статистики проекта
  async getStats(projectName) {
    const { rows } = await pool.query(`
      SELECT 
        COUNT(*) as document_count,
        SUM(total_chunks) as total_chunks,
        MIN(created_at) as first_document,
        MAX(created_at) as last_document
      FROM "${projectName}".documents
    `);
    return rows[0];
  }
}

export default new ProjectQueries();
