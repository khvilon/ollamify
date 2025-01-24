import fetch from 'node-fetch';
import logger from './utils/logger.js';

export async function getEmbeddingDimension(model) {
    try {
      const response = await fetch('http://ollama:11434/api/embeddings', {
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
    const response = await fetch('http://ollama:11434/api/embeddings', {
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
