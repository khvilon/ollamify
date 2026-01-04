import fetch from 'node-fetch';
import logger from './utils/logger.js';
import { resolveOllamaBaseUrlForModel } from './utils/ollama.js';

export async function getEmbeddingDimension(model) {
    try {
      // Если модель FRIDA, у нее фиксированная размерность 1536
      if (model === 'frida') {
        logger.info(`Model ${model} has fixed dimension of 1536`);
        return 1536;
      }
      
      const ollamaBaseUrl = await resolveOllamaBaseUrlForModel(model);
      const response = await fetch(`${ollamaBaseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: 'test' })
      });

      if (!response.ok) {
        throw new Error(`Failed to get embedding: ${response.statusText}`);
      }

      const data = await response.json();
      logger.info(`Model ${model} returned embedding with dimension ${data.embedding.length}`);
      return data.embedding.length;
    } catch (error) {
      logger.error(`Error determining embedding dimension for model ${model}:`, error);
      throw error;
    }
}

export async function getEmbedding(text, model) {
  try {
    // Если используется FRIDA, получаем эмбеддинги из отдельного сервиса
    if (model === 'frida') {
      return getEmbeddingFromFrida(text);
    }
    
    const ollamaBaseUrl = await resolveOllamaBaseUrlForModel(model);
    const response = await fetch(`${ollamaBaseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to get embedding. Status: ${response.status}, Response: ${errText}`);
    }

    const data = await response.json();
    logger.info(`Got embedding with dimension ${data.embedding.length} from model ${model}`);
    return data.embedding;
  } catch (error) {
    logger.error('Error getting embedding:', error);
    throw error;
  }
}

// Функция для получения эмбеддингов от сервиса FRIDA
async function getEmbeddingFromFrida(text) {
  try {
    // Для текста поиска используем префикс search_query, для документов search_document
    const isQuery = text.length < 200; // Эвристика: короткие тексты считаем запросами
    const prompt_name = isQuery ? 'search_query' : 'search_document';
    
    // Используем новый сервис FRIDA
    const response = await fetch('http://frida:8002/embed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        texts: [text],
        prompt_name: prompt_name
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to get FRIDA embedding. Status: ${response.status}, Response: ${errText}`);
    }

    const data = await response.json();
    
    // Проверка размерности вектора
    if (data.dimension !== 1536) {
      logger.error(`FRIDA returned embedding with unexpected dimension: ${data.dimension}, expected 1536`);
      throw new Error(`FRIDA dimension mismatch: expected 1536, got ${data.dimension}`);
    }
    
    logger.info(`Got FRIDA embedding with dimension ${data.dimension}`);
    return data.embeddings[0]; // Возвращаем первый эмбеддинг (для одного текста)
  } catch (error) {
    logger.error('Error getting FRIDA embedding:', error);
    throw error;
  }
}

export function splitIntoChunks(text, maxChunkSize = 1500) {
  const chunks = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk.length + sentence.length) > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    currentChunk += sentence + ' ';
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
