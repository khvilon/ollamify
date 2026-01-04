import express from 'express';
import fetch from 'node-fetch';
import pool from '../db/conf.js';
import { createProjectSchema } from '../db/init.js';
import { getEmbedding, getEmbeddingDimension } from '../embeddings.js';
import logger from '../utils/logger.js';
import { resolveOllamaBaseUrlForModel } from '../utils/ollama.js';
import qdrantClient from '../db/qdrant.js';

const router = express.Router();

const MAX_KEYWORD_LENGTH = 60;
const MAX_KEYWORD_WORDS = 4;
const MAX_KEYWORDS_FOR_SEARCH = 10;
const MAX_AGGREGATED_QUERY_LENGTH = 200;
const THINK_TAG_REGEX = /<(?:think|thinking|анализ|размышление)[^>]*>[\s\S]*?<\/(?:think|thinking|анализ|размышление)[^>]*>/gi;

function normalizeKeywordCandidates(candidates, maxKeywords) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const normalizedKeywords = [];
  const seen = new Set();

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const trimmed = candidate
      .replace(THINK_TAG_REGEX, '')
      .trim()
      .replace(/^['"`«»]+|['"`«»]+$/g, '')
      .replace(/\s+/g, ' ');

    if (!trimmed) {
      continue;
    }

    if (trimmed.length > MAX_KEYWORD_LENGTH) {
      continue;
    }

    if (/^</.test(trimmed) || trimmed.includes('>')) {
      continue;
    }

    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > MAX_KEYWORD_WORDS) {
      continue;
    }

    if (!/[A-Za-zА-Яа-я0-9]/.test(trimmed)) {
      continue;
    }

    const canonical = trimmed.toLowerCase();
    if (seen.has(canonical)) {
      continue;
    }

    seen.add(canonical);
    normalizedKeywords.push(trimmed);

    if (normalizedKeywords.length >= maxKeywords) {
      break;
    }
  }

  return normalizedKeywords;
}

// Функция для извлечения секций размышлений из ответа LLM
function extractThinkingSection(response) {
  if (!response || typeof response !== 'string') {
    return { answer: response, thinking: null };
  }

  // Ищем секции <think>...</think> (возможны вариации: thinking, анализ и т.д.)
  const thinkingRegex = /<(?:think|thinking|анализ|размышление)[^>]*>([\s\S]*?)<\/(?:think|thinking|анализ|размышление)>/gi;
  
  let thinking = null;
  let cleanedResponse = response;
  
  // Извлекаем все секции размышлений
  const matches = [...response.matchAll(thinkingRegex)];
  
  if (matches.length > 0) {
    // Собираем все размышления в один блок
    thinking = matches.map(match => match[1].trim()).join('\n\n---\n\n');
    
    // Удаляем все теги размышлений из основного ответа
    cleanedResponse = response.replace(thinkingRegex, '').trim();
    
    logger.info('Extracted thinking section:', {
      hasThinking: true,
      thinkingLength: thinking.length,
      originalLength: response.length,
      cleanedLength: cleanedResponse.length
    });
  }
  
  return {
    answer: cleanedResponse,
    thinking: thinking
  };
}

// Поиск релевантных документов по эмбеддингу вопроса
async function findRelevantDocuments(questionEmbedding, project, embeddingModel, limit) {
  try {
    // Проверяем существование коллекции в Qdrant
    const collectionExists = await qdrantClient.collectionExists(project);
    
    if (!collectionExists) {
      logger.info(`Creating new collection for project ${project}`);
      const dimension = await getEmbeddingDimension(embeddingModel);
      await qdrantClient.createCollection(project, dimension);
    }

    // Создаем фильтр проекта
    const filter = {
      must: [
        { key: 'project', match: { value: project } }
      ]
    };
    
    // Ищем релевантные документы, всегда с фильтром по проекту
    logger.info(`Searching Qdrant with strict project filter for: ${project}`);
    const relevantDocs = await qdrantClient.search(project, questionEmbedding, limit, filter);
    
    logger.info(`Found ${relevantDocs.length} relevant documents in Qdrant for project ${project}`);
    
    // Дополнительная проверка, что все результаты действительно из нужного проекта
    const wrongProjectDocs = relevantDocs.filter(doc => doc.project !== project);
    if (wrongProjectDocs.length > 0) {
      logger.warn(`Warning: Found ${wrongProjectDocs.length} documents from wrong projects: ${wrongProjectDocs.map(d => d.project).join(', ')}`);
    }
    
    return relevantDocs;
  } catch (error) {
    logger.error(`Error finding relevant documents for project ${project}:`, error);
    throw error;
  }
}

async function findKeywordDocuments(keywords, project, limit = 20) {
  const sanitizedKeywords = Array.isArray(keywords)
    ? normalizeKeywordCandidates(keywords, MAX_KEYWORDS_FOR_SEARCH)
    : [];

  if (sanitizedKeywords.length === 0) {
    logger.info('No keywords provided for keyword-based search');
    return [];
  }

  const docMap = new Map();

  const addDocsToMap = (docs, matchLabel) => {
    docs.forEach(doc => {
      if (!doc || !doc.content) {
        return;
      }

      const docKey = `${doc.project || project}::${doc.filename || 'unknown'}::${doc.content.substring(0, 300)}`;

      if (!docMap.has(docKey)) {
        docMap.set(docKey, {
          filename: doc.filename || 'unknown',
          content: doc.content,
          project: doc.project || project,
          metadata: doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
            ? { ...doc.metadata }
            : {},
          keywordScore: typeof doc.similarity === 'number' ? doc.similarity : 0,
          similarity: typeof doc.similarity === 'number' ? doc.similarity : 0,
          keywordMatches: new Set()
        });
      }

      const entry = docMap.get(docKey);
      const docScore = typeof doc.similarity === 'number' ? doc.similarity : 0;

      entry.keywordScore = Math.max(entry.keywordScore, docScore);
      entry.similarity = Math.max(entry.similarity, docScore);

      if (doc.metadata && doc.metadata.__keywordMatches && Array.isArray(doc.metadata.__keywordMatches)) {
        doc.metadata.__keywordMatches.forEach(match => entry.keywordMatches.add(match));
      }

      if (matchLabel) {
        entry.keywordMatches.add(matchLabel);
      }
    });
  };

  const aggregatedKeywordsSubset = sanitizedKeywords.slice(0, Math.min(sanitizedKeywords.length, 5));
  const aggregatedQuery = aggregatedKeywordsSubset.join(' ');
  const aggregatedQueryForSearch = aggregatedQuery.length > MAX_AGGREGATED_QUERY_LENGTH
    ? aggregatedQuery.slice(0, MAX_AGGREGATED_QUERY_LENGTH)
    : aggregatedQuery;

  try {
    if (aggregatedQueryForSearch.length > 0) {
      logger.info('Running aggregated keyword search in Qdrant:', {
        project,
        aggregatedQuery: aggregatedQueryForSearch
      });

      const aggregatedDocs = await qdrantClient.searchByText(project, aggregatedQueryForSearch, limit);
      addDocsToMap(aggregatedDocs, aggregatedQueryForSearch);
    }

    const perKeywordLimit = Math.max(3, Math.ceil(limit / Math.min(sanitizedKeywords.length, 5)));

    for (const keyword of sanitizedKeywords) {
      logger.info('Running keyword search in Qdrant:', {
        project,
        keyword
      });

      const keywordDocs = await qdrantClient.searchByText(project, keyword, perKeywordLimit);
      addDocsToMap(keywordDocs, keyword);
    }
  } catch (error) {
    logger.error('Error during keyword search in Qdrant:', error);
  }

  const keywordDocs = Array.from(docMap.values()).map(entry => {
    const keywordMatches = Array.from(entry.keywordMatches);
    const metadata = { ...entry.metadata };

    if (keywordMatches.length > 0) {
      metadata.__keywordMatches = keywordMatches;
    }

    metadata.__keywordScore = entry.keywordScore;

    return {
      filename: entry.filename,
      content: entry.content,
      project: entry.project,
      similarity: entry.keywordScore,
      keywordScore: entry.keywordScore,
      metadata
    };
  });

  logger.info('Keyword search summary:', {
    project,
    keywords: sanitizedKeywords,
    aggregatedQuery: aggregatedQueryForSearch,
    totalUniqueDocuments: keywordDocs.length
  });

  return keywordDocs;
}

function createScoreNormalizer(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return () => 0;
  }

  const numericValues = values.filter(value => typeof value === 'number' && !Number.isNaN(value));

  if (numericValues.length === 0) {
    return () => 0;
  }

  const max = Math.max(...numericValues);
  const min = Math.min(...numericValues);
  const range = max - min;

  if (range === 0) {
    return () => 1;
  }

  return value => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 0;
    }
    return (value - min) / range;
  };
}

function mergeHybridResults(embeddingDocs, keywordDocs, limit) {
  const docMap = new Map();

  const makeKey = doc => {
    const project = doc.project || 'unknown_project';
    const filename = doc.filename || 'unknown_file';
    const contentPreview = doc.content ? doc.content.substring(0, 400) : '';
    return `${project}::${filename}::${contentPreview}`;
  };

  const addDoc = (doc, source) => {
    if (!doc || !doc.content) {
      return;
    }

    const key = makeKey(doc);

    if (!docMap.has(key)) {
      docMap.set(key, {
        filename: doc.filename || 'unknown',
        content: doc.content,
        project: doc.project,
        metadata: doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
          ? { ...doc.metadata }
          : {},
        embeddingScore: null,
        keywordScore: null,
        keywordMatches: new Set(),
        sources: new Set()
      });
    }

    const entry = docMap.get(key);

    if (source === 'embedding' && typeof doc.similarity === 'number' && !Number.isNaN(doc.similarity)) {
      entry.embeddingScore = entry.embeddingScore !== null
        ? Math.max(entry.embeddingScore, doc.similarity)
        : doc.similarity;
    }

    if (source === 'keyword') {
      const keywordScoreCandidate = typeof doc.keywordScore === 'number' && !Number.isNaN(doc.keywordScore)
        ? doc.keywordScore
        : (typeof doc.similarity === 'number' && !Number.isNaN(doc.similarity) ? doc.similarity : null);

      if (keywordScoreCandidate !== null) {
        entry.keywordScore = entry.keywordScore !== null
          ? Math.max(entry.keywordScore, keywordScoreCandidate)
          : keywordScoreCandidate;
      }

      if (doc.metadata && Array.isArray(doc.metadata.__keywordMatches)) {
        doc.metadata.__keywordMatches.forEach(match => entry.keywordMatches.add(match));
      }
    }

    if (doc.metadata && Array.isArray(doc.metadata.__keywordMatches)) {
      doc.metadata.__keywordMatches.forEach(match => entry.keywordMatches.add(match));
    }

    if (doc.metadata && doc.metadata.__keywordScore && typeof doc.metadata.__keywordScore === 'number') {
      entry.keywordScore = entry.keywordScore !== null
        ? Math.max(entry.keywordScore, doc.metadata.__keywordScore)
        : doc.metadata.__keywordScore;
    }

    entry.metadata = {
      ...entry.metadata,
      ...(doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata) ? doc.metadata : {})
    };

    if (!entry.project && doc.project) {
      entry.project = doc.project;
    }

    entry.sources.add(source);
  };

  embeddingDocs.forEach(doc => addDoc(doc, 'embedding'));
  keywordDocs.forEach(doc => addDoc(doc, 'keyword'));

  const embeddingScores = [];
  const keywordScores = [];

  docMap.forEach(entry => {
    if (typeof entry.embeddingScore === 'number' && !Number.isNaN(entry.embeddingScore)) {
      embeddingScores.push(entry.embeddingScore);
    }
    if (typeof entry.keywordScore === 'number' && !Number.isNaN(entry.keywordScore)) {
      keywordScores.push(entry.keywordScore);
    }
  });

  const normalizeEmbedding = createScoreNormalizer(embeddingScores);
  const normalizeKeyword = createScoreNormalizer(keywordScores);

  const EMBEDDING_WEIGHT = 0.65;
  const KEYWORD_WEIGHT = 0.35;
  const DUAL_SOURCE_BONUS = 0.05;

  const hasEmbeddingScores = embeddingScores.length > 0;
  const hasKeywordScores = keywordScores.length > 0;

  const mergedDocs = Array.from(docMap.values()).map(entry => {
    const rawEmbeddingScore = entry.embeddingScore;
    const rawKeywordScore = entry.keywordScore;

    const embeddingComponent = rawEmbeddingScore !== null
      ? (hasKeywordScores ? normalizeEmbedding(rawEmbeddingScore) : rawEmbeddingScore)
      : 0;

    const keywordComponent = rawKeywordScore !== null
      ? (hasEmbeddingScores ? normalizeKeyword(rawKeywordScore) : rawKeywordScore)
      : 0;

    let hybridScore;

    if (hasEmbeddingScores && hasKeywordScores) {
      let combinedScore = embeddingComponent * EMBEDDING_WEIGHT + keywordComponent * KEYWORD_WEIGHT;

      if (rawEmbeddingScore !== null && rawKeywordScore !== null) {
        combinedScore += DUAL_SOURCE_BONUS;
      }

      if (combinedScore > 1) {
        combinedScore = Math.min(combinedScore, 1.0);
      }

      hybridScore = combinedScore;
    } else if (hasEmbeddingScores) {
      hybridScore = embeddingComponent;
    } else {
      hybridScore = keywordComponent;
    }

    const keywordMatches = Array.from(entry.keywordMatches);
    const metadata = entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
      ? { ...entry.metadata }
      : {};

    if (keywordMatches.length > 0) {
      metadata.__keywordMatches = Array.from(new Set([...(metadata.__keywordMatches || []), ...keywordMatches]));
    }

    metadata.__retrieval = {
      embeddingScore: rawEmbeddingScore,
      keywordScore: rawKeywordScore,
      embeddingContribution: embeddingComponent,
      keywordContribution: keywordComponent,
      hybridScore,
      sources: Array.from(entry.sources)
    };

    return {
      filename: entry.filename,
      content: entry.content,
      project: entry.project,
      similarity: hybridScore,
      metadata
    };
  });

  mergedDocs.sort((a, b) => b.similarity - a.similarity);

  if (typeof limit === 'number' && limit > 0) {
    return mergedDocs.slice(0, limit);
  }

  return mergedDocs;
}

// Получение ответа от LLM
async function getAnswer(context, question) {
  logger.info('Sending request to OpenRouter API:', {
    url: process.env.OPENROUTER_URL,
    model: process.env.OPENROUTER_MODEL,
    contextLength: context.length
  });

  const messages = [
    {
      role: "system",
      content: `You are a helpful assistant that answers questions based on the provided context. 
                Always answer in the same language as the question.`
    },
    {
      role: "user",
      content: `Context:
${context}

Question: ${question}`
    }
  ];

  try {
    const response = await fetch(process.env.OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Ollamify'
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1024
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    logger.error('Error in getAnswer:', error);
    throw error;
  }
}

// Отправка запроса к OpenRouter API или Ollama
async function getCompletion(messages, model, think = true) {
  const maxTokens = 8192;

  // Model is selected per-request:
  // - local Ollama: "llama3.1:8b"
  // - OpenRouter proxy: "openrouter/<provider>/<model>"
  //
  // `OPENROUTER_MODEL` is treated as an optional legacy fallback.
  const resolvedModel = model || process.env.OPENROUTER_MODEL;

  if (!resolvedModel) {
    throw new Error('Missing model. Provide "model" (Ollama) or "openrouter/..." in the request body.');
  }

  const isOpenRouter = resolvedModel.startsWith('openrouter/');
  const actualModel = isOpenRouter ? resolvedModel.substring(10).replace(/^\/+/, '') : resolvedModel;

  // Проверяем, не является ли модель моделью для эмбеддингов
  const embeddingModels = ['all-minilm', 'nomic-embed-text', 'all-MiniLM-L6-v2', 'frida', 'bge-m3'];
  
  if (embeddingModels.includes(actualModel) || actualModel.endsWith(':latest')) {
    // Дополнительная проверка для моделей с :latest
    const baseModel = actualModel.replace(':latest', '');
    if (embeddingModels.includes(baseModel)) {
      throw new Error(`"${actualModel}" is an embedding model and cannot be used for text generation`);
    }
  }

  logger.info('Getting completion:', {
    service: isOpenRouter ? 'OpenRouter' : 'Ollama',
    model: actualModel,
    messagesCount: messages.length
  });

  // Логируем входящие сообщения для анализа
  logger.info('LLM Input Messages:', {
    model: actualModel,
    service: isOpenRouter ? 'OpenRouter' : 'Ollama',
    messages: messages.map((msg, index) => ({
      index,
      role: msg.role,
      contentLength: msg.content ? msg.content.length : 0,
      content: msg.content
    }))
  });

  try {
    if (isOpenRouter) {
      const response = await fetch(process.env.OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Ollamify'
        },
        body: JSON.stringify({
          model: actualModel,
          messages: messages,
          temperature: 0.7,
          max_tokens: maxTokens,
          think: think
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenRouter API error: ${error}`);
      }

      const data = await response.json();
      if (data.error) {
        const errorMessage = data.error.message;
        const providerError = data.error.metadata?.raw ? JSON.parse(data.error.metadata.raw).error : null;
        throw new Error(`API Error: ${errorMessage}${providerError ? `. Provider details: ${providerError.message}` : ''}`);
      }
      if (!data.choices || !data.choices.length) {
        throw new Error(`API returned invalid response format: missing choices array. Response: ${JSON.stringify(data)}`);
      }
      
      const llmResponse = data.choices[0].message.content;
      logger.info('LLM Response from OpenRouter:', {
        model: actualModel,
        service: 'OpenRouter',
        responseLength: llmResponse.length,
        response: llmResponse
      });
      
      return llmResponse;
    } else {
      const ollamaBaseUrl = await resolveOllamaBaseUrlForModel(actualModel);
      const response = await fetch(`${ollamaBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: actualModel,
          messages: messages,
          stream: false,
          options: {
            num_ctx: maxTokens
          },
          think: think
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error: ${error}`);
      }

      const data = await response.json();
      
      const llmResponse = data.choices[0].message.content;
      logger.info('LLM Response from Ollama:', {
        model: actualModel,
        service: 'Ollama',
        responseLength: llmResponse.length,
        response: llmResponse
      });
      
      return llmResponse;
    }
  } catch (error) {
    logger.error('Error in getCompletion:', error);
    throw error;
  }
}

/**
 * @swagger
 * /ai/embed:
 *   post:
 *     tags: [AI & Embeddings]
 *     summary: Получить эмбеддинги для текста
 *     description: |
 *       Получает векторные представления (embeddings) для текста, используя указанную модель.
 *       
 *       **Важно:** Модель теперь является обязательным параметром.
 *       Убедитесь, что указанная модель установлена в Ollama.
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - model
 *               - input
 *             properties:
 *               model:
 *                 type: string
 *                 description: Название embedding модели
 *                 example: "frida"
 *               input:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *                 description: Текст или массив текстов для получения эмбеддингов
 *                 example: "Пример текста для векторизации"
 *               encoding_format:
 *                 type: string
 *                 default: "float"
 *                 description: Формат кодирования (пока только float)
 *           examples:
 *             single_text:
 *               summary: Одиночный текст
 *               value:
 *                 model: "frida"
 *                 input: "Привет, как дела?"
 *             multiple_texts:
 *               summary: Несколько текстов
 *               value:
 *                 model: "frida"
 *                 input: ["Первый текст", "Второй текст", "Третий текст"]
 *     responses:
 *       200:
 *         description: Успешно получены эмбеддинги
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 object:
 *                   type: string
 *                   example: "list"
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       object:
 *                         type: string
 *                         example: "embedding"
 *                       embedding:
 *                         type: array
 *                         items:
 *                           type: number
 *                         description: Векторное представление текста
 *                       index:
 *                         type: integer
 *                         description: Индекс в исходном массиве
 *                 model:
 *                   type: string
 *                   description: Использованная модель
 *                 usage:
 *                   type: object
 *                   properties:
 *                     prompt_tokens:
 *                       type: integer
 *                       example: -1
 *                     total_tokens:
 *                       type: integer
 *                       example: -1
 *       400:
 *         description: Отсутствует обязательный параметр model
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: "Model parameter is required"
 *                     type:
 *                       type: string
 *                       example: "invalid_request_error"
 *       500:
 *         description: Ошибка получения эмбеддингов
 */
// Получение эмбеддинга для текста в формате OpenAI API
router.post('/embed', async (req, res) => {
  const { 
    model,
    input,
    encoding_format = 'float'
  } = req.body;

  if (!model) {
    return res.status(400).json({
      error: {
        message: 'Model parameter is required',
        type: 'invalid_request_error',
        code: null
      }
    });
  }
  
  try {
    // Убедимся, что input всегда массив
    const inputs = Array.isArray(input) ? input : [input];
    
    // Получаем эмбеддинги для каждого текста
    const embeddings = await Promise.all(inputs.map(async (text) => {
      const ollamaBaseUrl = await resolveOllamaBaseUrlForModel(model);
      const response = await fetch(`${ollamaBaseUrl}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, prompt: text })
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error: ${error}`);
      }

      const data = await response.json();
      return data.embedding;
    }));

    // Форматируем ответ в стиле OpenAI API
    const response = {
      object: 'list',
      data: embeddings.map((embedding, index) => ({
        object: 'embedding',
        embedding,
        index
      })),
      model,
      usage: {
        prompt_tokens: -1,  // Не поддерживается
        total_tokens: -1    // Не поддерживается
      }
    };

    res.json(response);
  } catch (error) {
    logger.error('Error getting embedding:', error);
    res.status(500).json({ 
      error: {
        message: error.message,
        type: 'invalid_request_error',
        code: null
      }
    });
  }
});

/**
 * @swagger
 * /v1/chat/completions:
 *   post:
 *     tags: [OpenAI Compatible]
 *     summary: OpenAI совместимые чат-завершения
 *     description: |
 *       **Важно:** Этот эндпоинт доступен по пути `/api/v1/chat/completions` и полностью совместим с OpenAI Chat API.
 *       
 *       Поддерживает:
 *       - Ollama модели (локальные)
 *       - OpenRouter модели (внешние, с префиксом `openrouter/`)
 *       - Потоковую передачу (только для Ollama)
 *       - Все стандартные параметры OpenAI API
 *       
 *       **Примеры моделей:**
 *       - `llama3.1:8b` (Ollama)
 *       - `openrouter/anthropic/claude-3.5-sonnet` (OpenRouter)
 *       - `openrouter/openai/gpt-4` (OpenRouter)
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatCompletion'
 *           examples:
 *             simple_chat:
 *               summary: Простой чат
 *               value:
 *                 model: "llama3.1:8b"
 *                 messages:
 *                   - role: "user"
 *                     content: "Привет! Как дела?"
 *             conversation:
 *               summary: Многосообщенческий диалог
 *               value:
 *                 model: "llama3.1:8b"
 *                 messages:
 *                   - role: "system"
 *                     content: "Ты полезный ассистент"
 *                   - role: "user"
 *                     content: "Объясни принцип работы нейронных сетей"
 *                   - role: "assistant"
 *                     content: "Нейронные сети работают..."
 *                   - role: "user"
 *                     content: "А как обучаются?"
 *                 temperature: 0.7
 *                 max_tokens: 1000
 *             streaming:
 *               summary: Потоковый ответ (только Ollama)
 *               value:
 *                 model: "llama3.1:8b"
 *                 messages:
 *                   - role: "user"
 *                     content: "Расскажи длинную историю"
 *                 stream: true
 *             openrouter_model:
 *               summary: Использование OpenRouter модели
 *               value:
 *                 model: "openrouter/anthropic/claude-3.5-sonnet"
 *                 messages:
 *                   - role: "user"
 *                     content: "Анализируй этот код и предложи улучшения"
 *                 temperature: 0.3
 *                 max_tokens: 2000
 *     responses:
 *       200:
 *         description: Успешное завершение чата
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatCompletionResponse'
 *             examples:
 *               success_response:
 *                 summary: Обычный ответ
 *                 value:
 *                   id: "chatcmpl-123"
 *                   object: "chat.completion"
 *                   created: 1677652288
 *                   model: "llama3.1:8b"
 *                   choices:
 *                     - index: 0
 *                       message:
 *                         role: "assistant"
 *                         content: "Привет! У меня все отлично, спасибо за вопрос!"
 *                       finish_reason: "stop"
 *                   usage:
 *                     prompt_tokens: 10
 *                     completion_tokens: 15
 *                     total_tokens: 25
 *           text/event-stream:
 *             schema:
 *               type: string
 *               description: Server-Sent Events поток для stream=true
 *             example: |
 *               data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"llama3.1:8b","choices":[{"index":0,"delta":{"content":"Привет"},"finish_reason":null}]}
 *               
 *               data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1677652288,"model":"llama3.1:8b","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}
 *               
 *               data: [DONE]
 *       400:
 *         description: Неверные параметры запроса
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                     type:
 *                       type: string
 *                     code:
 *                       type: string
 *             examples:
 *               invalid_model:
 *                 summary: Неверная модель
 *                 value:
 *                   error:
 *                     message: "all-minilm is an embedding model and cannot be used for text generation"
 *                     type: "invalid_request_error"
 *                     code: null
 *               streaming_not_supported:
 *                 summary: Стриминг не поддерживается
 *                 value:
 *                   error:
 *                     message: "Streaming is not supported for OpenRouter models"
 *                     type: "invalid_request_error"
 *                     code: null
 *       401:
 *         description: Неверный API ключ
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Ошибка сервера
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                     type:
 *                       type: string
 *                     code:
 *                       type: string
 */

/**
 * @swagger
 * /ai/complete:
 *   post:
 *     tags: [Internal]
 *     summary: Внутренний эндпоинт для чат-завершений (не для внешнего использования)
 *     description: |
 *       **ВНУТРЕННИЙ ЭНДПОИНТ** - не используйте его напрямую.
 *       Этот эндпоинт используется через nginx прокси для `/api/v1/chat/completions`.
 *       Для внешнего использования применяйте `/api/v1/chat/completions`.
 *     deprecated: true
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatCompletion'
 *     responses:
 *       200:
 *         description: Успешное завершение
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatCompletionResponse'
 *       400:
 *         description: Ошибка запроса
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Ошибка сервера
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/complete', async (req, res) => {
  const { 
    model,
    messages,
    temperature = 0.7,
    max_tokens = 1024,
    stream = false,
    think = true
  } = req.body;
  
  try {
    if (!model || !messages) {
      return res.status(400).json({ error: 'Missing required parameters: model, messages' });
    }

    if (stream) {
      // Устанавливаем заголовки для SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Пока не поддерживаем стриминг для OpenRouter
      if (model.startsWith('openrouter/')) {
        throw new Error('Streaming is not supported for OpenRouter models');
      }

      const ollamaBaseUrl = await resolveOllamaBaseUrlForModel(actualModel);
      const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          stream: true
        })
      });

      // Читаем ответ построчно через современный асинхронный итератор
      for await (const chunk of response.body) {
        const decoder = new TextDecoder();
        const decodedChunk = decoder.decode(chunk);
        
        try {
          const data = JSON.parse(decodedChunk);
          
          // Проверяем, нужно ли завершить поток
          if (data.done) {
            res.write('data: [DONE]\n\n');
            res.end();
            break;
          }
          
          // Форматируем ответ в стиле OpenAI
          const openAIChunk = {
            id: 'cmpl-' + Math.random().toString(36).substr(2, 9),
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: model,
            choices: [{
              index: 0,
              delta: {
                content: data.response
              },
              finish_reason: data.done ? 'stop' : null
            }]
          };
          
          res.write(`data: ${JSON.stringify(openAIChunk)}\n\n`);
        } catch (e) {
          logger.error('Error parsing streaming response:', e);
          continue; // Пропускаем ошибки парсинга - некоторые строки могут не быть валидным JSON
        }
      }
      
      // Если мы здесь, значит поток завершился без явного "done"
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      const content = await getCompletion(messages, model, think);
      
      // Форматируем ответ в стиле OpenAI
      const response = {
        id: 'cmpl-' + Math.random().toString(36).substr(2, 9),
        object: 'chat.completion',
        created: Date.now(),
        model: model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: content
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: -1,  // Не поддерживается
          completion_tokens: -1,  // Не поддерживается
          total_tokens: -1  // Не поддерживается
        }
      };

      res.json(response);
    }
  } catch (error) {
    logger.error('Error in completion:', error);
    res.status(500).json({ 
      error: {
        message: error.message,
        type: 'invalid_request_error',
        code: null
      }
    });
  }
});

async function getRelevantChunks(question, project, model, limit = 100, options = {}) {
  const numericLimit = typeof limit === 'number' ? limit : Number(limit) || 100;
  const {
    keywords: keywordsFromOptions = [],
    useHybridSearch = true
  } = options || {};

  const sanitizedKeywords = useHybridSearch
    ? Array.from(new Set(
        keywordsFromOptions
          .map(keyword => (typeof keyword === 'string' ? keyword.trim() : ''))
          .filter(keyword => keyword.length > 0)
      ))
    : [];

  const embeddingDocs = [];
  const keywordDocs = [];

  if (project) {
    logger.info(`Project specified: ${project}, running ${useHybridSearch ? 'hybrid' : 'embedding-only'} retrieval within this project`, {
      keywords: sanitizedKeywords,
      useHybridSearch
    });

    const projectResult = await pool.query(
      'SELECT name, embedding_model FROM admin.projects WHERE name = $1',
      [project]
    );

    if (projectResult.rows.length === 0) {
      throw new Error(`Project "${project}" not found`);
    }

    const projectInfo = projectResult.rows[0];
    logger.info(`Found project "${project}" with embedding model: ${projectInfo.embedding_model}`);

    const questionEmbedding = await getEmbedding(question, projectInfo.embedding_model);
    logger.info(`Finding embedding-based documents in project: ${project}`);

    const embeddingLimit = Math.max(numericLimit, Math.min(numericLimit * 2, 60));
    let projectEmbeddingDocs = await findRelevantDocuments(questionEmbedding, project, projectInfo.embedding_model, embeddingLimit);

    projectEmbeddingDocs = projectEmbeddingDocs
      .filter(doc => doc && doc.content)
      .map(doc => ({
        ...doc,
        project
      }));

    embeddingDocs.push(...projectEmbeddingDocs);

    if (useHybridSearch && sanitizedKeywords.length > 0) {
      logger.info('Finding keyword-based documents in project:', {
        project,
        keywords: sanitizedKeywords
      });

      const keywordLimit = Math.max(numericLimit, Math.min(numericLimit * 2, 80));
      let projectKeywordDocs = await findKeywordDocuments(sanitizedKeywords, project, keywordLimit);

      projectKeywordDocs = projectKeywordDocs
        .filter(doc => doc && doc.content)
        .map(doc => ({
          ...doc,
          project
        }));

      keywordDocs.push(...projectKeywordDocs);
    }
  } else {
    logger.info(`No project specified, running ${useHybridSearch ? 'hybrid' : 'embedding-only'} retrieval across all projects`, {
      keywords: sanitizedKeywords,
      useHybridSearch
    });

    const projectResult = await pool.query(
      'SELECT name, embedding_model FROM admin.projects'
    );

    const projects = projectResult.rows;

    if (projects.length === 0) {
      throw new Error('No projects found');
    }

    logger.info(`Searching in ${projects.length} projects: ${projects.map(p => p.name).join(', ')}`);

    await Promise.all(projects.map(async proj => {
      logger.info('Running embedding search for project:', proj.name);
      const questionEmbedding = await getEmbedding(question, proj.embedding_model);

      const embeddingLimit = Math.max(numericLimit, Math.min(numericLimit * 2, 60));
      let projectEmbeddingDocs = await findRelevantDocuments(questionEmbedding, proj.name, proj.embedding_model, embeddingLimit);

      projectEmbeddingDocs = projectEmbeddingDocs
        .filter(doc => doc && doc.content)
        .map(doc => ({
          ...doc,
          project: proj.name
        }));

      embeddingDocs.push(...projectEmbeddingDocs);

      if (useHybridSearch && sanitizedKeywords.length > 0) {
        logger.info('Running keyword search for project:', {
          project: proj.name,
          keywords: sanitizedKeywords
        });

        const keywordLimit = Math.max(numericLimit, Math.min(numericLimit * 2, 80));
        let projectKeywordDocs = await findKeywordDocuments(sanitizedKeywords, proj.name, keywordLimit);

        projectKeywordDocs = projectKeywordDocs
          .filter(doc => doc && doc.content)
          .map(doc => ({
            ...doc,
            project: proj.name
          }));

        keywordDocs.push(...projectKeywordDocs);
      }
    }));
  }

  const filteredEmbeddingDocs = embeddingDocs.filter(doc => doc && doc.content);
  const filteredKeywordDocs = keywordDocs.filter(doc => doc && doc.content);

  const hybridDocs = mergeHybridResults(filteredEmbeddingDocs, filteredKeywordDocs, numericLimit);

  // Для конкретного проекта убеждаемся, что документы принадлежат этому проекту
  const projectAwareDocs = project
    ? hybridDocs
        .filter(doc => doc.project === project || !doc.project)
        .map(doc => ({
          ...doc,
          project: project
        }))
    : hybridDocs;

  const finalDocs = projectAwareDocs.filter(doc => doc && doc.content).slice(0, numericLimit);

  const projectStats = finalDocs.reduce((acc, doc) => {
    const docProject = doc.project || 'unknown_project';
    acc[docProject] = (acc[docProject] || 0) + 1;
    return acc;
  }, {});

  logger.info('Hybrid retrieval summary:', {
    project: project || 'all_projects',
    requestedLimit: numericLimit,
    keywords: sanitizedKeywords,
    useHybridSearch,
    embeddingDocs: filteredEmbeddingDocs.length,
    keywordDocs: filteredKeywordDocs.length,
    returnedDocs: finalDocs.length,
    projectStats
  });

  return finalDocs;
}

// Функция для проверки состояния реранкера
async function checkRerankerHealth() {
  try {
    const response = await fetch('http://reranker:8001/health', {
      method: 'GET',
      timeout: 5000
    });
    return response.ok;
  } catch (error) {
    logger.error('Reranker health check failed:', error);
    return false;
  }
}

// Функция для переранжирования документов с использованием внешнего reranker сервиса
async function rerankDocuments(question, relevantDocs) {
  const MAX_RETRIES = 3;
  const INITIAL_TIMEOUT = 30000; // 30 секунд
  const MAX_TIMEOUT = 60000; // 60 секунд
  const TIMEOUT_INCREMENT = 15000; // 15 секунд

  let currentTimeout = INITIAL_TIMEOUT;
  let retryCount = 0;

  while (retryCount < MAX_RETRIES) {
    try {
      // Проверяем состояние реранкера перед запросом
      const isHealthy = await checkRerankerHealth();
      if (!isHealthy) {
        throw new Error('Reranker service is not healthy');
      }

      // Логируем исходные документы и их рейтинги
      logger.info(`Original documents ranking (attempt ${retryCount + 1}/${MAX_RETRIES}):`);
      relevantDocs.forEach((doc, index) => {
        logger.info(`${index + 1}. ${doc.filename} (similarity: ${doc.similarity.toFixed(4)})`);
      });

      logger.info(`Sending documents to reranker service (timeout: ${currentTimeout}ms, docs: ${relevantDocs.length})`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), currentTimeout);

      const startTime = Date.now();
      const response = await fetch('http://reranker:8001/rerank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: question,
          documents: relevantDocs
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const endTime = Date.now();
      const processingTime = endTime - startTime;

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Reranker service error: ${error}`);
      }

      const data = await response.json();
      logger.info(`Reranker processing completed in ${processingTime}ms`);

      let rerankedDocs = data.reranked_documents;
      
      // Проверяем и исправляем отрицательные значения similarity
      const hasNegative = rerankedDocs.some(doc => doc.similarity < 0);
      const needsNormalization = hasNegative || rerankedDocs.some(doc => doc.similarity > 1);
      
      if (needsNormalization) {
        logger.info('Normalizing reranker scores to [0, 1] range using absolute scale...');
        
        // Получаем текущие значения, выданные реранкером
        const newSimilarities = rerankedDocs.map(doc => doc.similarity);
        const minNewSim = Math.min(...newSimilarities);
        const maxNewSim = Math.max(...newSimilarities);
        
        // Находим минимальное и максимальное значение исходных similarity для информации
        const origSimilarities = relevantDocs.map(doc => doc.similarity);
        const minOrigSim = Math.min(...origSimilarities);
        const maxOrigSim = Math.max(...origSimilarities);
        
        // Фиксированные границы для реранкера
        // Обновлено на основе реальных данных: оценки примерно от -8 до 0
        const RERANKER_MIN_SCORE = -10;
        const RERANKER_MAX_SCORE = 0;
        
        logger.info(`Original similarity range: [${minOrigSim.toFixed(4)}, ${maxOrigSim.toFixed(4)}]`);
        logger.info(`Reranker similarity range: [${minNewSim.toFixed(4)}, ${maxNewSim.toFixed(4)}]`);
        logger.info(`Using fixed reranker scale: [${RERANKER_MIN_SCORE}, ${RERANKER_MAX_SCORE}]`);
        
        // Создаем таблицу соответствия для лучшего понимания
        logger.info('Reference scale:');
        [RERANKER_MIN_SCORE, -8, -6, -4, -2, -1, -0.5, RERANKER_MAX_SCORE].forEach(score => {
          const normalized = (score - RERANKER_MIN_SCORE) / (RERANKER_MAX_SCORE - RERANKER_MIN_SCORE);
          const clamped = Math.max(0, Math.min(1, normalized));
          logger.info(`Reranker score ${score.toFixed(1)} => similarity ${clamped.toFixed(4)}`);
        });
        
        // Нормализуем с учетом абсолютной шкалы
        rerankedDocs = rerankedDocs.map(doc => {
          // Создаем новый объект, чтобы не модифицировать оригинальный
          const newDoc = { ...doc };
          
          // Нормализуем в абсолютную шкалу [0, 1], где 0 соответствует RERANKER_MIN_SCORE,
          // а 1 соответствует RERANKER_MAX_SCORE
          newDoc.similarity = (doc.similarity - RERANKER_MIN_SCORE) / (RERANKER_MAX_SCORE - RERANKER_MIN_SCORE);
          
          // Ограничиваем значение, чтобы оно точно было в [0, 1]
          newDoc.similarity = Math.max(0, Math.min(1, newDoc.similarity));
          
          return newDoc;
        });
        
        // Логируем результаты нормализации
        const normalizedSimilarities = rerankedDocs.map(doc => doc.similarity);
        const minNormSim = Math.min(...normalizedSimilarities);
        const maxNormSim = Math.max(...normalizedSimilarities);
        logger.info(`Normalized similarity range (absolute scale): [${minNormSim.toFixed(4)}, ${maxNormSim.toFixed(4)}]`);
        
        // Показываем детальную информацию о нормализации для каждого документа
        logger.info('Detailed normalization results:');
        
        // Создаем таблицу для более читаемого вывода
        logger.info('| Документ | Оценка реранкера | Нормализованная | Векторная |');
        logger.info('|----------|-----------------|-----------------|-----------|');
        
        rerankedDocs.forEach((doc, index) => {
          const origDoc = relevantDocs.find(d => d.filename === doc.filename);
          const origScore = origDoc ? origDoc.similarity : 0;
          const origRawScore = data.reranked_documents[index].similarity; // Исходное значение до нормализации
          
          // Формируем строку таблицы
          logger.info(`| ${doc.filename.substring(0, 20)}${doc.filename.length > 20 ? '...' : ''} | ${origRawScore.toFixed(4)} | ${doc.similarity.toFixed(4)} | ${origScore.toFixed(4)} |`);
          
          // Также логируем в прежнем формате для совместимости
          logger.info(`${doc.filename}: Raw score ${origRawScore.toFixed(4)} => Normalized ${doc.similarity.toFixed(4)} (Original vector similarity: ${origScore.toFixed(4)})`);
        });
      }
      
      // Логируем результаты ререранкинга
      logger.info('Reranked documents ranking:');
      rerankedDocs.forEach((doc, index) => {
        // Добавляем пометку для очень низких скоров
        const scoreNote = doc.similarity < 0.01 ? ' [очень низкая релевантность]' : '';
        logger.info(`${index + 1}. ${doc.filename} (similarity: ${doc.similarity.toFixed(4)})${scoreNote}`);
      });
      
      // Логируем изменения в порядке документов
      if (rerankedDocs.length > 0) {
        logger.info('Changes in document ranking:');
        // Создаем карту исходных позиций
        const originalPositions = new Map();
        relevantDocs.forEach((doc, index) => {
          originalPositions.set(doc.filename, index);
        });
        
        // Статистика изменений
        let totalPositionChanges = 0;
        let improvedPositions = 0;
        let loweredPositions = 0;
        let unchangedPositions = 0;
        let maxImprovement = 0;
        let maxDrop = 0;
        let totalSimilarityChange = 0;
        
        // Показываем изменения в позициях
        rerankedDocs.forEach((doc, newIndex) => {
          const oldIndex = originalPositions.get(doc.filename);
          const change = oldIndex - newIndex;
          let changeText = "";
          
          if (change > 0) {
            changeText = `↑${change} (improved)`;
            improvedPositions++;
            maxImprovement = Math.max(maxImprovement, change);
          } else if (change < 0) {
            changeText = `↓${Math.abs(change)} (lowered)`;
            loweredPositions++;
            maxDrop = Math.max(maxDrop, Math.abs(change));
          } else {
            changeText = "no change";
            unchangedPositions++;
          }
          
          totalPositionChanges += Math.abs(change);
          
          // Найти оригинальный документ для сравнения similarity
          const originalDoc = relevantDocs.find(d => d.filename === doc.filename);
          const originalSimilarity = originalDoc ? originalDoc.similarity : 0;
          
          // Вместо прямого сравнения нормализованных значений, отображаем
          // изменение ранга в списке документов (более высокий ранг = лучше)
          let rankChangeText = "";
          if (change > 0) {
            rankChangeText = `улучшен на ${change} позиций`;
          } else if (change < 0) {
            rankChangeText = `понижен на ${Math.abs(change)} позиций`;
          } else {
            rankChangeText = "без изменений";
          }
          
          // Для similarity просто показываем новое значение, так как оно уже в диапазоне [0, 1]
          logger.info(`${doc.filename}: с позиции ${oldIndex + 1} на ${newIndex + 1} (${rankChangeText}), новая релевантность: ${doc.similarity.toFixed(4)} (исходная была ${originalSimilarity.toFixed(4)})`);
          
          // Для статистики по-прежнему используем разницу, но учитываем, что шкалы разные
          const similarityChange = 0; // мы не можем напрямую сравнивать оценки в разных шкалах
          totalSimilarityChange += Math.abs(change) / rerankedDocs.length; // используем изменение позиции как прокси
        });
        
        // Логируем общую статистику
        logger.info('Reranking statistics:');
        logger.info(`Total documents: ${rerankedDocs.length}`);
        logger.info(`Documents with improved position: ${improvedPositions} (${((improvedPositions / rerankedDocs.length) * 100).toFixed(1)}%)`);
        logger.info(`Documents with lowered position: ${loweredPositions} (${((loweredPositions / rerankedDocs.length) * 100).toFixed(1)}%)`);
        logger.info(`Documents with unchanged position: ${unchangedPositions} (${((unchangedPositions / rerankedDocs.length) * 100).toFixed(1)}%)`);
        logger.info(`Average position change: ${(totalPositionChanges / rerankedDocs.length).toFixed(2)}`);
        logger.info(`Maximum position improvement: ${maxImprovement}`);
        logger.info(`Maximum position drop: ${maxDrop}`);
        
        // Создаем карту новых позиций для вычисления метрики Кендалла тау
        const newPositions = new Map();
        rerankedDocs.forEach((doc, index) => {
          newPositions.set(doc.filename, index);
        });
        
        // Вычисляем корреляцию Кендалла тау
        let concordantPairs = 0;
        let discordantPairs = 0;
        
        for (let i = 0; i < relevantDocs.length; i++) {
          for (let j = i + 1; j < relevantDocs.length; j++) {
            const filenameI = relevantDocs[i].filename;
            const filenameJ = relevantDocs[j].filename;
            
            const origOrderI = originalPositions.get(filenameI);
            const origOrderJ = originalPositions.get(filenameJ);
            const newOrderI = newPositions.get(filenameI);
            const newOrderJ = newPositions.get(filenameJ);
            
            const originalOrder = origOrderI < origOrderJ;
            const newOrder = newOrderI < newOrderJ;
            
            if (originalOrder === newOrder) {
              concordantPairs++;
            } else {
              discordantPairs++;
            }
          }
        }
        
        const totalPairs = concordantPairs + discordantPairs;
        const kendallTau = totalPairs > 0 ? (concordantPairs - discordantPairs) / totalPairs : 0;
        
        logger.info(`Kendall's Tau correlation: ${kendallTau.toFixed(4)} (1.0 means identical ranking, -1.0 means completely reversed, 0 means no correlation)`);
      }

      logger.info('Documents reranked successfully');
      return rerankedDocs;

    } catch (error) {
      retryCount++;
      const errorType = error.name === 'AbortError' ? 'timeout' : 'service_error';
      logger.error(`Error calling reranker service (attempt ${retryCount}/${MAX_RETRIES}, type: ${errorType}):`, error);
      
      if (retryCount < MAX_RETRIES) {
        // Увеличиваем таймаут для следующей попытки
        currentTimeout = Math.min(currentTimeout + TIMEOUT_INCREMENT, MAX_TIMEOUT);
        logger.info(`Retrying in ${currentTimeout}ms...`);
        await new Promise(resolve => setTimeout(resolve, currentTimeout));
      } else {
        logger.error('Max retries reached, returning original documents');
        return relevantDocs;
      }
    }
  }

  return relevantDocs;
}

// Функция для извлечения смысловой части запроса
async function extractQueryIntent(originalQuery, model) {
  try {
    // If no model provided, do not block retrieval: fallback to original query.
    if (!model) {
      return {
        originalQuery,
        intentQuery: originalQuery
      };
    }

    logger.info('Extracting semantic intent from query:', {
      query: originalQuery,
      model: model
    });
    
    const messages = [
      {
        role: "system",
        content: `Your task is to extract the core information need from the user query for document retrieval.

          Ignore polite phrases, introductions, excess detail, or task instructions. Do not generate SQL, code, or answers. Focus only on the keywords or phrase that capture the user's true intent.

          Reply with only the reformulated query fragment — no comments or explanations. Use the same language as the original query.

          Examples:
          Query: "Could you please explain how vector search works in RAG?"
          Output: "vector search in RAG"

          Query: "What's the best way to store embeddings in PostgreSQL?"
          Output: "embedding storage in PostgreSQL"

          Query: "Generate an SQL query to find which products are in stock"
          Output: "SQL query: products in stock"

        `
      },
      {
        role: "user",
        content: originalQuery
      }
    ];
    
    // Используем указанную модель для получения ответа
    const intentQuery = await getCompletion(messages, model);
    logger.info('Extracted intent query:', {
      originalQuery,
      intentQuery,
      model
    });
    
    return {
      originalQuery,
      intentQuery
    };
  } catch (error) {
    logger.error('Error extracting query intent:', error);
    // В случае ошибки возвращаем исходный запрос
    return {
      originalQuery,
      intentQuery: originalQuery
    };
  }
}

async function extractKeywords(originalQuery, model, maxKeywords = 8) {
  try {
    const targetModel = model || process.env.OPENROUTER_MODEL;

    // If no model is available, fall back to a simple heuristic extraction.
    if (!targetModel) {
      const regexMatches = originalQuery.match(/[A-Za-zА-Яа-я0-9]+(?:[\s\-][A-Za-zА-Яа-я0-9]+){0,3}/g);
      return normalizeKeywordCandidates(regexMatches || [], maxKeywords);
    }

    logger.info('Extracting keywords from query:', {
      query: originalQuery,
      model: targetModel,
      maxKeywords
    });

    const messages = [
      {
        role: "system",
        content: `You are a retrieval assistant. Extract up to ${maxKeywords} key terms from the user query that best capture its subject matter for document search.

Rules:
- Only return concrete domain terms or multi-word phrases appearing in the query (including abbreviations).
- Exclude generic words such as "процедура", "алгоритм", "использование", "что", "как", "какие" unless they are part of a longer domain-specific phrase.
- Keep hyphenated or mixed-language tokens intact.
- Preserve the language and casing used in the query.
- Return ONLY a valid JSON array of strings without comments or extra text.
- If no suitable terms exist, return [] immediately.`
      },
      {
        role: "user",
        content: originalQuery
      }
    ];

    const rawResponse = await getCompletion(messages, targetModel, false);
    const strippedResponse = rawResponse
      .replace(THINK_TAG_REGEX, '')
      .replace(/```json?/gi, '')
      .replace(/```/g, '')
      .trim();

    const tryParseArray = (text) => {
      if (!text) return null;
      try {
        const directParsed = JSON.parse(text);
        if (Array.isArray(directParsed)) {
          return directParsed;
        }
      } catch (error) {
        // ignore, attempt substring parsing below
      }

      const start = text.indexOf('[');
      const end = text.lastIndexOf(']');
      if (start !== -1 && end !== -1 && end > start) {
        const jsonSlice = text.slice(start, end + 1);
        try {
          const sliceParsed = JSON.parse(jsonSlice);
          if (Array.isArray(sliceParsed)) {
            return sliceParsed;
          }
        } catch (error) {
          // ignore, fallback later
        }
      }

      return null;
    };

    let keywordCandidates = tryParseArray(strippedResponse);

    if (!Array.isArray(keywordCandidates) || keywordCandidates.length === 0) {
      logger.warn('Failed to parse keywords JSON, using regex-based extraction', {
        rawResponse: strippedResponse
      });

      const regexMatches = strippedResponse.match(/[A-Za-zА-Яа-я0-9]+(?:[\s\-][A-Za-zА-Яа-я0-9]+){0,3}/g);
      keywordCandidates = regexMatches || [];
    }

    const normalizedKeywords = normalizeKeywordCandidates(keywordCandidates, maxKeywords);

    logger.info('Keywords extracted:', { keywords: normalizedKeywords });

    return normalizedKeywords;
  } catch (error) {
    logger.error('Error extracting keywords:', error);
    return [];
  }
}

// Функция для умного отбора документов на основе падения релевантности
function smartDocumentSelection(documents, maxDocs = 8) {
  if (!documents || documents.length === 0) {
    logger.warn('smartDocumentSelection called with empty documents array');
    return [];
  }
  
  // Если у нас только один документ, просто возвращаем его
  if (documents.length === 1) {
    logger.info('smartDocumentSelection: only one document available, returning it without analysis');
    return documents;
  }
  
  // Проверяем, что во всех документах есть поле similarity и оно является числом
  const hasInvalidSimilarity = documents.some(doc => 
    typeof doc !== 'object' || 
    doc === null ||
    typeof doc.similarity !== 'number' || 
    isNaN(doc.similarity)
  );
  
  if (hasInvalidSimilarity) {
    logger.warn('smartDocumentSelection: some documents have invalid similarity values, using safe sorting');
    // Если есть проблемные документы, делаем безопасную сортировку
    const safeDocuments = documents.filter(doc => 
      doc && typeof doc === 'object' && typeof doc.similarity === 'number' && !isNaN(doc.similarity)
    );
    
    if (safeDocuments.length === 0) {
      logger.error('No valid documents found for selection');
      return documents.slice(0, Math.min(documents.length, maxDocs));
    }
    
    const sortedDocs = [...safeDocuments].sort((a, b) => 
      (b.similarity || 0) - (a.similarity || 0)
    );
    
    return sortedDocs.slice(0, Math.min(sortedDocs.length, maxDocs));
  }
  
  // Сортируем документы по similarity
  const sortedDocs = [...documents].sort((a, b) => b.similarity - a.similarity);
  
  // Берем не более maxDocs документов для анализа
  const docsToAnalyze = sortedDocs.slice(0, maxDocs);
  
  // Если у нас меньше 3 документов, просто возвращаем их все
  // потому что для алгоритма анализа падений нужно минимум 3 документа
  if (docsToAnalyze.length < 3) {
    logger.info(`smartDocumentSelection: only ${docsToAnalyze.length} documents available, returning all without analysis`);
    return docsToAnalyze;
  }
  
  // Анализируем локальные падения релевантности
  const LOCAL_DROP_THRESHOLD = 0.2; // 20% падение между соседними документами
  let cutoffIndex = docsToAnalyze.length;
  
  // Проверяем падения между соседними документами
  for (let i = 0; i < docsToAnalyze.length - 1; i++) {
    const currentSim = docsToAnalyze[i].similarity;
    const nextSim = docsToAnalyze[i + 1].similarity;
    const drop = (currentSim - nextSim) / currentSim;
    
    logger.info(`Checking drop between docs ${i + 1} and ${i + 2}:`, {
      currentDoc: docsToAnalyze[i].filename,
      nextDoc: docsToAnalyze[i + 1].filename,
      currentSim: currentSim.toFixed(4),
      nextSim: nextSim.toFixed(4),
      drop: (drop * 100).toFixed(1) + '%'
    });
    
    if (drop > LOCAL_DROP_THRESHOLD) {
      cutoffIndex = i + 1;
      logger.info(`Found significant drop (${(drop * 100).toFixed(1)}%) after document ${i + 1}`);
      break;
    }
  }
  
  // Если не нашли явных падений, используем референсное значение
  if (cutoffIndex === docsToAnalyze.length) {
    // Используем среднее по топ-2 документам как референсное значение
    const referenceSimilarity = docsToAnalyze.slice(0, 2).reduce((sum, doc) => sum + doc.similarity, 0) / 2;
    const GLOBAL_DROP_THRESHOLD = 0.3; // 30% падение от референсного значения
    const threshold = referenceSimilarity * (1 - GLOBAL_DROP_THRESHOLD);
    
    logger.info('No significant local drops found, using reference value:', {
      referenceSimilarity: referenceSimilarity.toFixed(4),
      threshold: threshold.toFixed(4),
      maxSimilarity: docsToAnalyze[0].similarity.toFixed(4),
      secondSimilarity: docsToAnalyze[1].similarity.toFixed(4)
    });
    
    // Находим первый документ, который падает ниже порога
    cutoffIndex = docsToAnalyze.findIndex(doc => doc.similarity < threshold);
    if (cutoffIndex === -1) cutoffIndex = docsToAnalyze.length;
    
    // Дополнительная проверка: если падение от максимума больше 40%, 
    // отсекаем на этом месте независимо от порога
    const maxSimilarity = docsToAnalyze[0].similarity;
    const maxDropThreshold = 0.4; // 40% падение от максимума
    
    for (let i = 1; i < docsToAnalyze.length; i++) {
      const dropFromMax = (maxSimilarity - docsToAnalyze[i].similarity) / maxSimilarity;
      if (dropFromMax > maxDropThreshold) {
        cutoffIndex = Math.min(cutoffIndex, i);
        logger.info(`Found significant drop from maximum (${(dropFromMax * 100).toFixed(1)}%) at document ${i + 1}`);
        break;
      }
    }
  }
  
  // Убедимся, что cutoffIndex находится в допустимых пределах
  cutoffIndex = Math.max(1, Math.min(cutoffIndex, docsToAnalyze.length));
  
  const selectedDocs = docsToAnalyze.slice(0, cutoffIndex);
  
  logger.info('Smart document selection results:', {
    totalDocs: documents.length,
    analyzedDocs: docsToAnalyze.length,
    selectedDocs: selectedDocs.length,
    cutoffIndex: cutoffIndex
  });
  
  // Логируем детали отбора
  logger.info('Document selection details:');
  docsToAnalyze.forEach((doc, index) => {
    const isSelected = index < cutoffIndex;
    const prevSim = index > 0 ? docsToAnalyze[index - 1].similarity : null;
    const dropFromPrev = prevSim ? ((prevSim - doc.similarity) / prevSim * 100).toFixed(1) : null;
    const dropFromMax = ((docsToAnalyze[0].similarity - doc.similarity) / docsToAnalyze[0].similarity * 100).toFixed(1);
    
    logger.info(`${index + 1}. ${doc.filename}: similarity=${doc.similarity.toFixed(4)}${dropFromPrev ? `, drop from prev=${dropFromPrev}%` : ''}, drop from max=${dropFromMax}%, selected=${isSelected}`);
  });
  
  return selectedDocs;
}

/**
 * @swagger
 * /ai/rag:
 *   post:
 *     tags: [AI & RAG]
 *     summary: Получить ответ используя RAG (Retrieval-Augmented Generation)
 *     description: |
 *       Использует поиск по документам (RAG) для генерации ответа на основе релевантных фрагментов из указанного проекта.
 *       
 *       **Алгоритм работы:**
 *       1. Извлекает семантический смысл из вопроса
 *       2. Находит релевантные фрагменты документов в проекте
 *       3. Опционально применяет переранжирование для улучшения качества
 *       4. Генерирует ответ используя найденный контекст
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/RagRequest'
 *               - type: object
 *                 properties:
 *                   useReranker:
 *                     type: boolean
 *                     description: Использовать переранжирование для улучшения качества результатов
 *                     example: true
 *                     default: true
 *                   limit:
 *                     type: integer
 *                     description: Максимальное количество документов для поиска
 *                     example: 20
 *                     default: 20
 *                     minimum: 1
 *                     maximum: 100
 *                   think:
 *                     type: boolean
 *                     description: Использовать переранжирование для улучшения качества результатов
 *                     example: true
 *                     default: true
 *                   useHybridSearch:
 *                     type: boolean
 *                     description: Включить гибридный поиск (эмбеддинги + ключевые слова). Если false, используется только поиск по эмбеддингам
 *                     example: true
 *                     default: true
 *           examples:
 *             basic_rag:
 *               summary: Простой RAG запрос
 *               value:
 *                 question: "Что такое машинное обучение?"
 *                 project: "ml-documents"
 *                 model: "llama3.1:8b"
 *                 think: true
  *                 useHybridSearch: true
 *             advanced_rag:
 *               summary: Продвинутый RAG с настройками
 *               value:
 *                 question: "Как применить нейронные сети в компьютерном зрении?"
 *                 project: "cv-research"
 *                 model: "llama3.1:8b"
 *                 useReranker: true
  *                 useHybridSearch: false
 *                 limit: 15
 *                 temperature: 0.3
 *                 max_tokens: 1500
 *                 think: true
 *     responses:
 *       200:
 *         description: Успешный ответ с найденными документами
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/RagResponse'
 *                 - type: object
 *                   properties:
 *                     relevantDocuments:
 *                       type: array
 *                       description: Финальный список релевантных документов (после переранжирования)
 *                       items:
 *                         type: object
 *                         properties:
 *                           filename:
 *                             type: string
 *                           content:
 *                             type: string
 *                           similarity:
 *                             type: number
 *                           project:
 *                             type: string
 *                           metadata:
 *                             type: object
 *                     originalDocuments:
 *                       type: array
 *                       description: Исходный список документов (до переранжирования)
 *                       items:
 *                         type: object
 *                         properties:
 *                           filename:
 *                             type: string
 *                           similarity:
 *                             type: number
 *                           project:
 *                             type: string
 *                           metadata:
 *                             type: object
 *                     intentQuery:
 *                       type: string
 *                       description: Извлеченный поисковый запрос
 *                     limitApplied:
 *                       type: integer
 *                       description: Фактически примененный лимит документов
 *             examples:
 *               success_response:
 *                 summary: Успешный ответ
 *                 value:
 *                   answer: "Машинное обучение - это область искусственного интеллекта..."
 *                   thinking: "Пользователь спрашивает об определении машинного обучения. Нужно дать точное и понятное объяснение..."
 *                   sources:
 *                     - document_name: "ml-intro.pdf"
 *                       chunk_content: "Машинное обучение представляет собой..."
 *                       score: 0.85
 *                   relevantDocuments:
 *                     - filename: "ml-intro.pdf"
 *                       content: "Машинное обучение представляет собой..."
 *                       similarity: 0.85
 *                       project: "ml-documents"
 *                       metadata: {}
 *                   intentQuery: "определение машинного обучения"
 *                   limitApplied: 20
 *       400:
 *         description: Неверные параметры запроса
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               missing_params:
 *                 summary: Отсутствуют обязательные параметры
 *                 value:
 *                   error: "Missing required parameters"
 *               invalid_model:
 *                 summary: Неверная модель
 *                 value:
 *                   error: "Invalid model selection"
 *                   details: "all-minilm is an embedding model and cannot be used for text generation"
 *       404:
 *         description: Не найдены релевантные документы
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Ошибка сервера
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/rag', async (req, res) => {
  const { question, project, model, useReranker = true, limit = 30, think = true, useHybridSearch } = req.body;

  if (!question || !project || !model) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    let hybridEnabled = true;
    if (typeof useHybridSearch === 'boolean') {
      hybridEnabled = useHybridSearch;
    } else if (typeof useHybridSearch === 'string') {
      hybridEnabled = !['false', '0', 'no', 'off'].includes(useHybridSearch.toLowerCase());
    }

    logger.info('POST /ai/rag request received:', {
      question,
      project,
      model,
      useReranker,
      limit: limit ? Number(limit) : 30,
      think,
      useHybridSearch: hybridEnabled
    });

    // Проверяем, не является ли выбранная модель моделью для эмбеддингов
    const embeddingModels = ['all-minilm', 'nomic-embed-text', 'all-MiniLM-L6-v2', 'frida', 'bge-m3'];
    const actualModelName = model.replace(':latest', '');
    
    if (embeddingModels.includes(model) || embeddingModels.includes(actualModelName)) {
      return res.status(400).json({ 
        error: 'Invalid model selection',
        details: `"${model}" is an embedding model and cannot be used for text generation. Please select a text generation model.`
      });
    }
    
    // Извлекаем смысловую часть запроса и ключевые слова в зависимости от режима поиска
    const intentPromise = extractQueryIntent(question, model);
    const keywordPromise = hybridEnabled ? extractKeywords(question, model) : Promise.resolve([]);
    const [intentResult, keywords] = await Promise.all([intentPromise, keywordPromise]);

    const { originalQuery, intentQuery } = intentResult;

    logger.info('Query intent extraction:', {
      originalQuery: question,
      extractedIntent: intentQuery,
      model,
      keywords,
      useHybridSearch: hybridEnabled
    });

    // Используем извлеченный запрос для поиска релевантных документов
    // Убедимся, что limit всегда число
    const numLimit = limit ? Number(limit) : 30;
    const relevantDocs = await getRelevantChunks(intentQuery, project, null, numLimit, {
      keywords,
      useHybridSearch: hybridEnabled
    });
    
    if (relevantDocs.length === 0) {
      logger.info('No relevant documents found');
      return res.status(404).json({ 
        error: 'No relevant documents found for this question' 
      });
    }

    // Сохраняем исходные документы и их similarity для возможности анализа и отладки
    const originalDocs = relevantDocs.map(doc => ({
      filename: doc.filename,
      similarity: doc.similarity,
      project: doc.project
    }));

    logger.info(`Found ${relevantDocs.length} relevant documents using intent query with limit=${numLimit}:`, relevantDocs.map(doc => doc.filename));

    // Логируем первоначальный контекст
    const originalContext = relevantDocs.map((doc, index) => `${index + 1}. Из документа ${doc.filename}:\n${doc.content.trim()}`).join('\n\n');
    logger.info('Original context order:');
    relevantDocs.forEach((doc, index) => {
      const preview = doc.content ? doc.content.trim().slice(0, 50) : '';
      logger.info(`-------- ORIGINAL CHUNK ${index + 1} --------`);
      logger.info(`Filename: ${doc.filename}`);
      logger.info(`Similarity: ${doc.similarity.toFixed(4)}`);
      logger.info(`Project: ${doc.project}`);
      logger.info(`Content preview: ${preview}${doc.content && doc.content.trim().length > 50 ? '…' : ''}`);
      logger.info(`------- END ORIGINAL CHUNK ${index + 1} -------`);
    });

    // Добавляем шаг переранжирования, если параметр useReranker включен
    let processedDocs = relevantDocs;
    if (useReranker) {
      logger.info('Applying reranking to documents using original query');
      // Для переранжирования используем исходный запрос, чтобы сохранить нюансы формулировки
      processedDocs = await rerankDocuments(question, relevantDocs);
      logger.info('Documents reranked');
      logger.info('Reranked context order:');
      processedDocs.forEach((doc, index) => {
        const preview = doc.content ? doc.content.trim().slice(0, 50) : '';
        logger.info(`-------- CHUNK ${index + 1} --------`);
        logger.info(`Filename: ${doc.filename}`);
        logger.info(`Similarity: ${doc.similarity.toFixed(4)}`);
        logger.info(`Project: ${doc.project}`);
        logger.info(`Content preview: ${preview}${doc.content && doc.content.trim().length > 50 ? '…' : ''}`);
        logger.info(`------- END CHUNK ${index + 1} -------`);
      });
    }
    
    // Применяем умный отбор документов
    processedDocs = smartDocumentSelection(processedDocs, 20);
    logger.info(`Selected ${processedDocs.length} documents using smart selection`);
    
    // Логируем финальный набор чанков, которые будут отправлены в LLM
    logger.info('FINAL CHUNKS FOR LLM INPUT:');
    processedDocs.forEach((doc, index) => {
      const preview = doc.content ? doc.content.trim().slice(0, 50) : '';
      logger.info(`-------- FINAL CHUNK ${index + 1} --------`);
      logger.info(`Filename: ${doc.filename}`);
      logger.info(`Similarity: ${doc.similarity.toFixed(4)}`);
      logger.info(`Project: ${doc.project}`);
      if (doc.metadata && Object.keys(doc.metadata).length > 0) {
        logger.info(`Metadata keys: ${Object.keys(doc.metadata).join(', ')}`);
      }
      logger.info(`Content preview: ${preview}${doc.content && doc.content.trim().length > 50 ? '…' : ''}`);
      logger.info(`------- END FINAL CHUNK ${index + 1} -------`);
    });

    // Формируем полный контекст для отправки в LLM с включением метаданных
    const context = `Найденные релевантные фрагменты:

${processedDocs.map((doc, index) => {
  // Формируем строку с метаданными, если они есть
  let metadataStr = '';
  if (doc.metadata && Object.keys(doc.metadata).length > 0) {
    metadataStr = '\nМетаданные документа:\n' + 
      Object.entries(doc.metadata)
        .map(([key, value]) => `- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
        .join('\n');
  }
  
  return `${index + 1}. Из документа ${doc.filename}:${metadataStr}
${doc.content.trim()}`;
}).join('\n\n')}`;
    
    // Логируем полный контекст, который отправляется в LLM
    logger.info('FULL CONTEXT FOR LLM:');
    logger.info(context);
    
    logger.info('Getting answer from LLM...');
    // Для получения ответа используем оригинальный запрос пользователя
    const rawAnswer = await getCompletion([
      {
        role: "system",
        content: `You are a helpful assistant that answers questions based on the provided context, including document content and metadata.
                  Pay attention to metadata fields like dates, authors, categories, and other attributes that might help you provide a more accurate answer.
                  Always answer in the same language as the question.`
      },
      {
        role: "user",
        content: `Context:
${context}

Question: ${question}`
      }
    ], model, think);

    // Извлекаем секции размышлений для RAG запросов
    const { answer, thinking } = extractThinkingSection(rawAnswer);

    logger.info('Sending response to client');
    const response = {
      answer,
      relevantDocuments: processedDocs.map(doc => ({
        filename: doc.filename,
        content: doc.content,
        similarity: doc.similarity,
        project: doc.project,
        metadata: doc.metadata || {}
      })),
      originalDocuments: originalDocs.map(doc => ({
        ...doc,
        metadata: doc.metadata || {}
      })),
      intentQuery: intentQuery,
      limitApplied: numLimit
    };

    // Добавляем thinking секцию только если она есть
    if (thinking) {
      response.thinking = thinking;
    }

    res.json(response);

  } catch (error) {
    logger.error('Error in ai/rag:', error);
    res.status(500).json({
      error: 'Failed to get answer',
      details: error.message
    });
  }
});

/**
 * @swagger
 * /ai/rag/chunks:
 *   post:
 *     tags: [AI & RAG]
 *     summary: Получить релевантные фрагменты документов
 *     description: |
 *       Возвращает релевантные фрагменты документов для заданного вопроса без генерации ответа.
 *       
 *       Полезно для:
 *       - Предварительного просмотра найденных документов
 *       - Отладки поискового алгоритма
 *       - Получения исходных данных для дальнейшей обработки
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - question
 *             properties:
 *               question:
 *                 type: string
 *                 description: Вопрос пользователя
 *                 example: "Что такое машинное обучение?"
 *               project:
 *                 type: string
 *                 description: Название проекта (опционально)
 *                 example: "ml-documents"
 *               limit:
 *                 type: integer
 *                 description: Максимальное количество фрагментов
 *                 example: 10
 *                 default: 100
 *                 minimum: 1
 *                 maximum: 100
 *               useHybridSearch:
 *                 type: boolean
 *                 description: Включить гибридный поиск (эмбеддинги + ключевые слова). Если false, используется только поиск по эмбеддингам
 *                 example: true
 *                 default: true
 *           examples:
 *             simple_chunks:
 *               summary: Поиск по всем проектам
 *               value:
 *                 question: "Что такое нейронные сети?"
 *                 limit: 5
  *                 useHybridSearch: true
 *             project_chunks:
 *               summary: Поиск в конкретном проекте
 *               value:
 *                 question: "Как обучать модели?"
 *                 project: "ml-tutorials"
 *                 limit: 10
  *                 useHybridSearch: false
 *     responses:
 *       200:
 *         description: Список релевантных фрагментов документов
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 relevantDocuments:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       filename:
 *                         type: string
 *                         description: Имя документа
 *                       content:
 *                         type: string
 *                         description: Содержимое фрагмента
 *                       similarity:
 *                         type: number
 *                         description: Оценка релевантности (0-1)
 *                       project:
 *                         type: string
 *                         description: Название проекта
 *                       metadata:
 *                         type: object
 *                         description: Метаданные документа
 *                 intentQuery:
 *                   type: string
 *                   description: Извлеченный поисковый запрос
 *                 limitApplied:
 *                   type: integer
 *                   description: Фактически примененный лимит
 *             examples:
 *               success_response:
 *                 summary: Успешный ответ
 *                 value:
 *                   relevantDocuments:
 *                     - filename: "neural-networks.pdf"
 *                       content: "Нейронные сети представляют собой..."
 *                       similarity: 0.89
 *                       project: "ml-documents"
 *                       metadata: {}
 *                   intentQuery: "определение нейронных сетей"
 *                   limitApplied: 10
 *       400:
 *         description: Неверные параметры запроса
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Релевантные документы не найдены
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Ошибка сервера
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/rag/chunks', async (req, res) => {
  const { question, project, model, limit = 100, useHybridSearch } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'Missing required parameters: question' });
  }

  try {
    let hybridEnabled = true;
    if (typeof useHybridSearch === 'boolean') {
      hybridEnabled = useHybridSearch;
    } else if (typeof useHybridSearch === 'string') {
      hybridEnabled = !['false', '0', 'no', 'off'].includes(useHybridSearch.toLowerCase());
    }

    logger.info('POST /ai/rag/chunks request received:', { 
      question, 
      project, 
      limit: limit ? Number(limit) : 100,
      useHybridSearch: hybridEnabled
    });
    
    // Извлекаем смысловую часть запроса для поиска
    // Модель можно передать опционально; если не передана — используем fallback (без LLM).
    const intentPromise = extractQueryIntent(question, model);
    const keywordPromise = hybridEnabled ? extractKeywords(question, model) : Promise.resolve([]);
    const [intentResult, keywords] = await Promise.all([intentPromise, keywordPromise]);

    const { originalQuery, intentQuery } = intentResult;

    logger.info('Query intent extraction for chunks:', {
      originalQuery: question,
      extractedIntent: intentQuery,
      keywords,
      useHybridSearch: hybridEnabled
    });
    
    // Используем извлеченный запрос для поиска релевантных документов
    // Убедимся, что limit всегда число
    const numLimit = limit ? Number(limit) : 100;
    const relevantDocs = await getRelevantChunks(intentQuery, project, null, numLimit, {
      keywords,
      useHybridSearch: hybridEnabled
    });
    
    if (relevantDocs.length === 0) {
      logger.info('No relevant documents found for chunks');
      return res.status(404).json({ 
        error: 'No relevant documents found for this question' 
      });
    }

    logger.info(`Found ${relevantDocs.length} relevant documents with limit=${numLimit}`);
    
    logger.info('Sending chunks to client');
    res.json({
      relevantDocuments: relevantDocs.map(doc => ({
        filename: doc.filename,
        content: doc.content,
        similarity: doc.similarity,
        project: doc.project,
        metadata: doc.metadata || {}
      })),
      intentQuery: intentQuery,
      limitApplied: numLimit
    });
  } catch (error) {
    logger.error('Error in ai/rag/chunks:', error);
    res.status(500).json({
      error: 'Failed to get relevant chunks',
      details: error.message
    });
  }
});

export default router;
