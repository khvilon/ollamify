import { QdrantClient as QdrantRestClient } from '@qdrant/js-client-rest';
import logger from '../utils/logger.js';

// Класс для взаимодействия с Qdrant
class QdrantClient {
  constructor() {
    // Фиксированные значения для подключения
    this.host = 'vector-db';
    this.port = 6333;
    this.url = `http://${this.host}:${this.port}`;
    
    // Создаем клиент Qdrant
    this.client = new QdrantRestClient({ url: this.url, checkCompatibility: false });
    
    logger.info(`QdrantClient initialized with URL: ${this.url}`);
  }

  _formatSearchResults(collectionName, points) {
    if (!Array.isArray(points)) {
      return [];
    }

    return points
      .map(item => {
        if (!item || !item.payload) {
          logger.warn(`Invalid point returned from Qdrant in collection ${collectionName}`);
          return {
            filename: 'unknown',
            content: '',
            project: collectionName,
            similarity: 0.0
          };
        }

        return {
          filename: item.payload.filename || 'unknown',
          content: item.payload.content || '',
          project: item.payload.project || collectionName,
          similarity: typeof item.score === 'number' ? item.score : 0.0,
          metadata: item.payload.metadata || {}
        };
      })
      .filter(item => item.content);
  }

  // Проверка статуса Qdrant
  async healthCheck() {
    try {
      // Запрашиваем коллекции как способ проверки здоровья вместо /health
      await this.client.getCollections();
      return { status: 'ok' };
    } catch (error) {
      logger.error('Qdrant health check failed:', error);
      throw error;
    }
  }

  // Создание коллекции (аналог схемы в PostgreSQL)
  async createCollection(collectionName, dimension, distance = 'Cosine') {
    try {
      logger.info(`Creating collection ${collectionName} with dimension ${dimension}`);
      
      // Стандартная конфигурация для всех коллекций - эмбеддинги создаются внешним сервисом
      const vectorsConfig = {
        size: dimension,
        distance
      };
      
      // Создаем коллекцию
      await this.client.createCollection(collectionName, { 
        vectors: vectorsConfig,
        optimizers_config: {
          default_segment_number: 2
        }
      });
      
      // Настраиваем payload схему (необязательно, но полезно)
      await this.client.updateCollection(collectionName, {
        payload_schema: {
          document_id: { type: 'integer' },
          chunk_index: { type: 'integer' },
          content: { type: 'text' },
          filename: { type: 'keyword' },
          project: { type: 'keyword' },
          created_at: { type: 'datetime' }
        }
      });
      
      // Создаем индекс для быстрого поиска по document_id
      await this.client.createPayloadIndex(collectionName, {
        field_name: 'document_id',
        field_schema: 'integer',
        wait: true
      });
      
      logger.info(`Collection ${collectionName} created successfully`);
      return { status: 'ok' };
    } catch (error) {
      logger.error(`Error creating collection ${collectionName}:`, error);
      throw error;
    }
  }

  // Получить модель эмбеддингов для проекта из базы данных
  async getProjectEmbeddingModel(projectName) {
    try {
      // Используем pool из импорта, чтобы не создавать циклическую зависимость
      const { pool } = await import('./conf.js');
      const { rows } = await pool.query(`
        SELECT embedding_model 
        FROM admin.projects 
        WHERE name = $1
        LIMIT 1
      `, [projectName]);
      
      if (rows.length === 0) {
        return null;
      }
      
      return rows[0].embedding_model;
    } catch (error) {
      logger.error(`Error getting embedding model for project ${projectName}:`, error);
      return null;
    }
  }

  // Проверка существования коллекции
  async collectionExists(collectionName) {
    try {
      const collections = await this.client.getCollections();
      return collections.collections.some(c => c.name === collectionName);
    } catch (error) {
      logger.error(`Error checking collection ${collectionName}:`, error);
      return false;
    }
  }

  // Удаление коллекции
  async deleteCollection(collectionName) {
    try {
      await this.client.deleteCollection(collectionName);
      logger.info(`Collection ${collectionName} deleted successfully`);
      return { status: 'ok' };
    } catch (error) {
      logger.error(`Error deleting collection ${collectionName}:`, error);
      throw error;
    }
  }

  // Вставка точек (чанки документов)
  async upsertPoints(collectionName, points) {
    try {
      // Преобразуем ID в числовой формат, который требует Qdrant
      const formattedPoints = points.map(point => {
        let formattedPoint = { ...point };
        
        // Если id уже число, используем его напрямую
        if (typeof point.id === 'number') {
          // ничего не делаем
        } else if (typeof point.id === 'string' && point.id.includes('_')) {
          // Если ID в формате "documentId_chunkIndex", преобразуем в числовой ID
          const [docId, chunkIndex] = point.id.split('_').map(Number);
          if (!isNaN(docId) && !isNaN(chunkIndex)) {
            formattedPoint.id = docId * 1000000 + chunkIndex;
          } else {
            formattedPoint.id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
          }
        } else {
          // В крайнем случае, генерируем случайный числовой ID
          formattedPoint.id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
        }
        
        return formattedPoint;
      });
      
      const result = await this.client.upsert(collectionName, {
        wait: true,
        points: formattedPoints
      });
      
      logger.info(`Upserted ${points.length} points into collection ${collectionName}`);
      return result;
    } catch (error) {
      logger.error(`Error upserting points into collection ${collectionName}:`, error);
      throw error;
    }
  }

  // Поиск ближайших документов к вектору
  async search(collectionName, vector, limit = 10, filter = null) {
    try {
      // Если вектор null, нам нужен только фильтр
      if (!vector && !filter) {
        throw new Error('Either vector or filter must be provided for search');
      }
      
      const searchParams = {
        limit,
        with_payload: true
      };
      
      // Добавляем вектор, если он есть
      if (vector) {
        searchParams.vector = vector;
      }
      
      // Добавляем фильтр, если он есть, всегда включая фильтр по проекту
      if (filter) {
        // Если передан фильтр, добавляем в него условие проекта
        if (!filter.must) {
          filter.must = [];
        }
        // Проверяем, чтобы не добавить дублирующееся условие
        const hasProjectFilter = filter.must.some(cond => 
          cond.key === 'project' && cond.match && cond.match.value === collectionName
        );
        if (!hasProjectFilter) {
          filter.must.push({ key: 'project', match: { value: collectionName } });
          logger.info(`Added project filter to existing filter: ${collectionName}`);
        }
        searchParams.filter = filter;
      } else {
        // Добавляем фильтр по проекту, чтобы возвращать документы только из указанного проекта
        // collectionName совпадает с именем проекта
        searchParams.filter = {
          must: [
            { key: 'project', match: { value: collectionName } }
          ]
        };
        logger.info(`Added project filter to search: ${collectionName}`);
      }
      
      let points = [];
      try {
        if (vector) {
          const result = await this.client.search(collectionName, searchParams);
          points = Array.isArray(result) ? result : [];
        } else {
          const result = await this.client.scroll(collectionName, { limit, filter, with_payload: true });
          points = Array.isArray(result.points) ? result.points : [];
        }
      } catch (searchError) {
        logger.error(`Search in collection ${collectionName} failed:`, searchError);
        return []; // Возвращаем пустой массив в случае ошибки
      }
      
      logger.info(`Found ${points.length} points in collection ${collectionName}`);
      
      // Проверяем, что у всех результатов указан проект
      if (points.length > 0) {
        const missingProject = points.filter(p => p && p.payload && !p.payload.project);
        if (missingProject.length > 0) {
          logger.warn(`${missingProject.length} points in collection ${collectionName} don't have project field`);
        }
        
        const missingScore = points.filter(p => p && typeof p.score === 'undefined');
        if (missingScore.length > 0) {
          logger.warn(`${missingScore.length} points in collection ${collectionName} don't have score field`);
        }
      }

      return this._formatSearchResults(collectionName, points);
    } catch (error) {
      logger.error(`Error searching in collection ${collectionName}:`, error);
      // Возвращаем пустой массив вместо выбрасывания исключения
      return [];
    }
  }

  async searchByText(collectionName, textQuery, limit = 10) {
    if (!textQuery || !textQuery.trim()) {
      logger.warn(`Empty text query provided for collection ${collectionName}`);
      return [];
    }

    const trimmedQuery = textQuery.trim();
    const truncatedForLog = trimmedQuery.length > 200 ? `${trimmedQuery.slice(0, 200)}…` : trimmedQuery;

    const filter = {
      must: [
        { key: 'project', match: { value: collectionName } },
        { key: 'content', match: { text: trimmedQuery } }
      ]
    };

    try {
      logger.info(`Performing text search (scroll) in collection ${collectionName} with query: "${truncatedForLog}"`);
      const result = await this.client.scroll(collectionName, {
        limit,
        filter,
        with_payload: true,
        with_vector: false
      });
      const points = Array.isArray(result.points) ? result.points : [];
      logger.info(`Text scroll returned ${points.length} points for collection ${collectionName}`);
      return this._formatSearchResults(collectionName, points);
    } catch (error) {
      logger.error(`Text scroll search failed in collection ${collectionName}:`, error);
      return [];
    }
  }

  // Удаление документа со всеми чанками
  async deleteDocument(collectionName, documentId) {
    try {
      // Преобразуем documentId в число, если он передан как строка
      const numericDocumentId = parseInt(documentId, 10);
      
      logger.info(`Attempting to delete document ${documentId} (numeric: ${numericDocumentId}) from collection ${collectionName}`);
      
      const result = await this.client.delete(collectionName, {
        filter: {
          must: [
            { key: 'document_id', match: { value: numericDocumentId } }
          ]
        },
        wait: true
      });
      
      logger.info(`Delete operation result for document ${documentId}:`, result);
      logger.info(`Deleted document ${documentId} from collection ${collectionName}`);
      return result;
    } catch (error) {
      logger.error(`Error deleting document ${documentId} from collection ${collectionName}:`, error);
      throw error;
    }
  }
  
  // Получение списка всех коллекций
  async listCollections() {
    try {
      const result = await this.client.getCollections();
      return result.collections || [];
    } catch (error) {
      logger.error('Error listing collections:', error);
      throw error;
    }
  }
}

// Экспортируем синглтон
export default new QdrantClient(); 