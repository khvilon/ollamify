import pool from './conf.js';
import { NotFoundError } from '../errors.js';
import { createProjectSchema } from './init.js';
import { getEmbedding, getEmbeddingDimension } from '../embeddings.js';
import crypto from 'crypto';

export const DocumentQueries = {


  // Получение документа по ID
  async findById(project, id) {
    const { rows } = await pool.query(`
      SELECT 
        d.*,
        c.content,
        '${project}' as project
      FROM "${project}".documents d
      LEFT JOIN "${project}".chunks c ON c.document_id = d.id
      WHERE d.id = $1
    `, [id]);
    
    if (!rows.length) {
      throw new NotFoundError('Document');
    }
    
    return rows[0];
  },


  // Удаление документа
  async delete(project, id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Удаляем чанки
      await client.query(`
        DELETE FROM "${project}".chunks
        WHERE document_id = $1
      `, [id]);

      // Удаляем документ
      const { rows } = await client.query(`
        DELETE FROM "${project}".documents
        WHERE id = $1
        RETURNING id
      `, [id]);

      if (!rows.length) {
        throw new NotFoundError('Document');
      }

      await client.query('COMMIT');
      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
}

export default DocumentQueries;
