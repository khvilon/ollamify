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
    this.client = new QdrantRestClient({ url: this.url });
    
    logger.info(`QdrantClient initialized with URL: ${this.url}`);
  }

  // Проверка статуса Qdrant
  async healthCheck() {
    try {
      // В новой версии клиента Qdrant метод перенесен
      const response = await fetch(`${this.url}/health`);
      if (response.ok) {
        return { status: 'ok' };
      } else {
        throw new Error(`Health check failed with status ${response.status}`);
      }
    } catch (error) {
      logger.error('Qdrant health check failed:', error);
      throw error;
    }
  }

  // Создание коллекции (аналог схемы в PostgreSQL)
  async createCollection(collectionName, dimension, distance = 'Cosine') {
    try {
      logger.info(`Creating collection ${collectionName} with dimension ${dimension}`);
      
      // Определяем схему коллекции
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
        // Если id уже число, используем его напрямую
        if (typeof point.id === 'number') {
          return point;
        }
        
        // Если ID в формате "documentId_chunkIndex", преобразуем в числовой ID
        if (typeof point.id === 'string' && point.id.includes('_')) {
          // Создаем уникальный числовой ID, объединяя documentId и chunkIndex
          // Например, для document_id=1, chunk_index=462, создадим ID вида 1000462
          const [docId, chunkIndex] = point.id.split('_').map(Number);
          // Убедимся, что оба компонента - числа
          if (!isNaN(docId) && !isNaN(chunkIndex)) {
            const numericId = docId * 1000000 + chunkIndex; // Это даст нам уникальный числовой ID
            return {
              ...point,
              id: numericId
            };
          }
        }
        
        // В крайнем случае, генерируем случайный числовой ID
        return {
          ...point,
          id: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
        };
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
      
      // Добавляем фильтр, если он есть
      if (filter) {
        searchParams.filter = filter;
      }
      
      const result = vector
        ? await this.client.search(collectionName, searchParams)
        : await this.client.scroll(collectionName, { limit, filter, with_payload: true });
      
      // Приводим формат к единому виду
      const points = vector ? result : (result.points || []);
      
      // Преобразуем формат ответа для совместимости с текущим API
      return points.map(item => ({
        filename: item.payload.filename,
        content: item.payload.content,
        project: item.payload.project,
        similarity: item.score || 1.0 // Если нет score (при фильтрации), ставим 1.0
      }));
    } catch (error) {
      logger.error(`Error searching in collection ${collectionName}:`, error);
      throw error;
    }
  }

  // Удаление документа со всеми чанками
  async deleteDocument(collectionName, documentId) {
    try {
      const result = await this.client.delete(collectionName, {
        filter: {
          must: [
            { key: 'document_id', match: { value: documentId } }
          ]
        },
        wait: true
      });
      
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