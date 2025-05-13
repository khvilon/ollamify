import pool from './conf.js';
import { NotFoundError } from '../errors.js';
import { createProjectSchema } from './init.js';
import { getEmbedding, getEmbeddingDimension } from '../embeddings.js';
import crypto from 'crypto';
import qdrantClient from './qdrant.js';
import logger from '../utils/logger.js';

export const DocumentQueries = {

  // Получение документа по ID
  async findById(project, id) {
    const { rows } = await pool.query(`
      SELECT 
        d.*,
        '${project}' as project
      FROM "${project}".documents d
      WHERE d.id = $1
    `, [id]);
    
    if (!rows.length) {
      throw new NotFoundError('Document');
    }
    
    // Получаем первый чанк документа из Qdrant для отображения содержимого
    try {
      const filter = {
        must: [
          { key: 'document_id', match: { value: id } },
          { key: 'chunk_index', match: { value: 0 } }
        ]
      };
      
      const results = await qdrantClient.search(project, null, 1, filter);
      if (results.length > 0) {
        rows[0].content = results[0].content;
      }
    } catch (error) {
      console.error(`Error getting document content from Qdrant:`, error);
    }
    
    return rows[0];
  },

  // Удаление документа
  async delete(project, id) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Удаляем документ из PostgreSQL
      const { rows } = await client.query(`
        DELETE FROM "${project}".documents
        WHERE id = $1
        RETURNING id
      `, [id]);

      if (!rows.length) {
        throw new NotFoundError('Document');
      }

      await client.query('COMMIT');
      
      // Удаляем документ из Qdrant
      try {
        await qdrantClient.deleteDocument(project, id);
      } catch (qdrantError) {
        logger.error(`Error deleting document from Qdrant:`, qdrantError);
        // Не блокируем выполнение, так как основные данные уже удалены из PostgreSQL
      }
      
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
