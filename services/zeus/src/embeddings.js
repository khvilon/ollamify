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

/**
 * Splits text into chunks optimized for embedding and vector search.
 *
 * Best practices implemented:
 *  1. Structural awareness — respects paragraph boundaries so chunks align
 *     with logical sections of the document.
 *  2. Robust sentence splitting — handles Latin/Cyrillic, abbreviations like
 *     "e.g.", "т.д.", decimals, ellipsis, and URLs without false breaks.
 *  3. Minimum chunk size — tiny trailing fragments (the "short snippets"
 *     that match everything in vector search) are merged into the previous
 *     chunk instead of living on their own.
 *  4. Overlap — each chunk (except the first) is prepended with the tail of
 *     the previous chunk so the embedding captures cross-boundary context.
 *
 * @param {string} text  – input text (normally after sanitizeText)
 * @param {object|number} [options] – config object, or a bare number for
 *   backwards-compatible maxChunkSize
 * @param {number} [options.maxChunkSize=1500] – target max characters
 * @param {number} [options.minChunkSize=100]  – chunks smaller than this are
 *   merged with a neighbour
 * @param {number} [options.overlapSize=200]   – characters of overlap from the
 *   previous chunk prepended to the next one
 * @returns {string[]}
 */
export function splitIntoChunks(text, options = {}) {
  /* backwards compat: splitIntoChunks(text, 2000) */
  if (typeof options === 'number') {
    options = { maxChunkSize: options };
  }

  const {
    maxChunkSize = 1500,
    minChunkSize = 100,
    overlapSize  = 200,
  } = options;

  if (!text || typeof text !== 'string') return [];
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxChunkSize) return [trimmed];

  // ── 1. Split into paragraphs ──────────────────────────────────────
  // sanitizeText now preserves \n\n as paragraph separators.
  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map(p => p.replace(/\n/g, ' ').trim())   // single newlines → spaces
    .filter(p => p.length > 0);

  // ── 2. Break paragraphs into atomic units (sentences / word-groups) ─
  const atoms = [];
  for (const para of paragraphs) {
    const sentences = _splitSentences(para);
    for (const s of sentences) {
      if (s.length <= maxChunkSize) {
        atoms.push(s);
      } else {
        // Extremely long "sentence" — split by words
        atoms.push(..._splitByWords(s, maxChunkSize));
      }
    }
  }

  // ── 3. Greedy assembly into chunks ────────────────────────────────
  const rawChunks = [];
  let current = '';

  for (const atom of atoms) {
    const sep = current.length > 0 ? ' ' : '';
    if ((current.length + sep.length + atom.length) > maxChunkSize && current.length > 0) {
      rawChunks.push(current.trim());
      current = atom;
    } else {
      current += sep + atom;
    }
  }
  if (current.trim().length > 0) {
    rawChunks.push(current.trim());
  }
  if (rawChunks.length === 0) return [];

  // ── 4. Merge small chunks with neighbours ─────────────────────────
  // This is the key step that prevents tiny "garbage" fragments (a few
  // characters at the end of a document) from polluting vector search.
  const softMax = Math.ceil(maxChunkSize * 1.2);   // allow slight overflow
  const merged = [];
  for (let i = 0; i < rawChunks.length; i++) {
    const chunk = rawChunks[i];
    if (chunk.length < minChunkSize && merged.length > 0) {
      // Try to append to the previous chunk
      const prev = merged[merged.length - 1];
      if ((prev.length + 1 + chunk.length) <= softMax) {
        merged[merged.length - 1] = prev + ' ' + chunk;
        continue;
      }
      // Previous would overflow — try prepending to the next chunk
      if (i + 1 < rawChunks.length &&
          (chunk.length + 1 + rawChunks[i + 1].length) <= softMax) {
        rawChunks[i + 1] = chunk + ' ' + rawChunks[i + 1];
        continue;
      }
    }
    merged.push(chunk);
  }

  // Final safeguard: if the last chunk is still too short, fold it back
  if (merged.length >= 2 && merged[merged.length - 1].length < minChunkSize) {
    const tail = merged.pop();
    merged[merged.length - 1] += ' ' + tail;
  }
  if (merged.length === 0) return [];

  // ── 5. Prepend overlap from previous chunk ────────────────────────
  if (overlapSize <= 0 || merged.length <= 1) return merged;

  const result = [merged[0]];
  for (let i = 1; i < merged.length; i++) {
    const overlapText = _overlapAtWordBoundary(merged[i - 1], overlapSize);
    if (overlapText) {
      result.push(overlapText + ' ' + merged[i]);
    } else {
      result.push(merged[i]);
    }
  }
  return result;
}

/* ─── Internal helpers ────────────────────────────────────────────── */

/**
 * Sentence splitter that avoids false breaks at abbreviations, decimals,
 * ellipses and URLs.  Works for Latin and Cyrillic text.
 *
 * Heuristic: split after .!?… when the next non-space character is an
 * uppercase letter or an opening quote/bracket.  This means "e.g. foo"
 * and "3.14 bar" are NOT split, while "Hello. World" is.
 */
function _splitSentences(text) {
  if (!text) return [];

  // Matches .!?… followed by whitespace, then an uppercase Latin/Cyrillic
  // letter, opening quote or bracket — the typical start of a new sentence.
  const parts = text.split(
    /(?<=[.!?…])\s+(?=[A-ZА-ЯЁ"'«(\[—–])/u
  );

  const result = parts.map(s => s.trim()).filter(s => s.length > 0);
  return result.length > 0 ? result : [text.trim()];
}

/**
 * Fallback: split a very long string at word boundaries.
 */
function _splitByWords(text, maxLen) {
  const words = text.split(/\s+/);
  const chunks = [];
  let current = '';

  for (const word of words) {
    const sep = current.length > 0 ? ' ' : '';
    if ((current.length + sep.length + word.length) > maxLen && current.length > 0) {
      chunks.push(current);
      current = word;
    } else {
      current += sep + word;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Extract the last ~targetSize characters of text, snapped to a word
 * boundary so we don't cut a word in half.
 * Returns '' if the text is too short or the overlap would be trivial.
 */
function _overlapAtWordBoundary(text, targetSize) {
  if (!text || targetSize <= 0 || text.length <= targetSize) return '';

  let start = text.length - targetSize;
  // Walk forward to the nearest space
  const spaceIdx = text.indexOf(' ', start);
  if (spaceIdx !== -1 && spaceIdx < text.length - 1) {
    start = spaceIdx + 1;
  }

  const overlap = text.slice(start).trim();
  // Don't return trivially short overlaps
  return overlap.length >= 20 ? overlap : '';
}
