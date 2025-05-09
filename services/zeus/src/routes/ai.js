import express from 'express';
import fetch from 'node-fetch';
import pool from '../db/conf.js';
import { createProjectSchema } from '../db/init.js';
import { getEmbedding, getEmbeddingDimension } from '../embeddings.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Поиск релевантных документов по эмбеддингу вопроса
async function findRelevantDocuments(questionEmbedding, project, embeddingModel) {
  const client = await pool.connect();
  try {
    // Проверяем существование схемы проекта
    const schemaExists = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = $1
    `, [project]);

    if (schemaExists.rows.length === 0) {
      logger.info(`Creating new schema for project ${project}`);
      const dimension = await getEmbeddingDimension(embeddingModel);
      await createProjectSchema(project, dimension);
    }

    // Преобразуем массив в формат вектора PostgreSQL
    const vectorLiteral = `[${questionEmbedding.join(',')}]`;

    const result = await client.query(`
      SELECT 
        d.name as filename,
        c.content,
        1 - (c.embedding <=> $1::vector) as similarity
      FROM "${project}".chunks c
      JOIN "${project}".documents d ON d.id = c.document_id
      WHERE c.embedding IS NOT NULL 
        AND 1 - (c.embedding <=> $1::vector) > 0.1
      ORDER BY similarity DESC
      LIMIT 5
    `, [vectorLiteral]);

    return result.rows;
  } finally {
    client.release();
  }
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
async function getCompletion(messages, model = process.env.OPENROUTER_MODEL) {
  const maxTokens = 8192;
  const isOpenRouter = model.startsWith('openrouter/');
  const actualModel = isOpenRouter ? model.substring(10).replace(/^\/+/, '') : model;

  // Проверяем, не является ли модель моделью для эмбеддингов
  const embeddingModels = ['all-minilm', 'nomic-embed-text', 'all-MiniLM-L6-v2'];
  const embeddingModel = process.env.EMBEDDING_MODEL || 'all-minilm';
  
  if (embeddingModels.includes(actualModel) || actualModel === embeddingModel || 
      actualModel === `${embeddingModel}:latest`) {
    throw new Error(`"${actualModel}" is an embedding model and cannot be used for text generation`);
  }

  logger.info('Getting completion:', {
    service: isOpenRouter ? 'OpenRouter' : 'Ollama',
    model: actualModel,
    messagesCount: messages.length
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
          max_tokens: maxTokens
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
      return data.choices[0].message.content;
    } else {
      const response = await fetch('http://ollama:11434/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: actualModel,
          messages: messages,
          stream: false,
          "options": {
            "num_ctx": maxTokens
          }
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama API error: ${error}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    }
  } catch (error) {
    logger.error('Error in getCompletion:', error);
    throw error;
  }
}

// Получение эмбеддинга для текста в формате OpenAI API
router.post('/embed', async (req, res) => {
  const { 
    model = process.env.EMBEDDING_MODEL || 'nomic-embed-text',
    input,
    encoding_format = 'float'
  } = req.body;
  
  try {
    // Убедимся, что input всегда массив
    const inputs = Array.isArray(input) ? input : [input];
    
    // Получаем эмбеддинги для каждого текста
    const embeddings = await Promise.all(inputs.map(async (text) => {
      const response = await fetch('http://ollama:11434/api/embeddings', {
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
 * /ai/complete:
 *   post:
 *     tags: [AI]
 *     summary: Generate text completion
 *     description: Generate text using AI model with optional streaming
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatCompletion'
 *     responses:
 *       200:
 *         description: Generated completion
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   description: Response ID
 *                 object:
 *                   type: string
 *                   enum: [chat.completion]
 *                 created:
 *                   type: integer
 *                   description: Unix timestamp
 *                 model:
 *                   type: string
 *                   description: Model used
 *                 choices:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       index:
 *                         type: integer
 *                       message:
 *                         $ref: '#/components/schemas/ChatMessage'
 *                       finish_reason:
 *                         type: string
 *                         enum: [stop, length]
 *           text/event-stream:
 *             schema:
 *               type: string
 *               description: Server-sent events stream for streaming responses
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/complete', async (req, res) => {
  const { 
    model = process.env.OPENROUTER_MODEL,
    messages,
    temperature = 0.7,
    max_tokens = 1024,
    stream = false
  } = req.body;
  
  try {
    if (stream) {
      // Устанавливаем заголовки для SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Пока не поддерживаем стриминг для OpenRouter
      if (model.startsWith('openrouter/')) {
        throw new Error('Streaming is not supported for OpenRouter models');
      }

      const response = await fetch('http://ollama:11434/api/chat', {
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

      // Читаем ответ построчно
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          res.write('data: [DONE]\n\n');
          res.end();
          break;
        }
        const chunk = decoder.decode(value);
        const data = JSON.parse(chunk);
        
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
      }
    } else {
      const content = await getCompletion(messages, model);
      
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

async function getRelevantChunks(question, project, model, limit) {
  let projects;
  if (project) {
    const projectResult = await pool.query(
      'SELECT name, embedding_model FROM admin.projects WHERE name = $1',
      [project]
    );
    if (projectResult.rows.length === 0) {
      throw new Error('Project not found');
    }
    projects = projectResult.rows;
  } else {
    const projectResult = await pool.query(
      'SELECT name, embedding_model FROM admin.projects'
    );
    projects = projectResult.rows;
    if (projects.length === 0) {
      throw new Error('No projects found');
    }
  }

  let allRelevantDocs = [];
  await Promise.all(projects.map(async (proj) => {
    logger.info('Getting embedding for question in project:', proj.name);
    const questionEmbedding = await getEmbedding(question, proj.embedding_model);
    logger.info('Finding relevant documents in project:', proj.name);
    let relevantDocs = await findRelevantDocuments(questionEmbedding, proj.name, proj.embedding_model);
    if (limit && relevantDocs.length > limit) {
      relevantDocs = relevantDocs.slice(0, limit);
    }
    // Добавляем информацию о проекте к каждому документу
    relevantDocs = relevantDocs.map(doc => ({
      ...doc,
      project: proj.name
    }));
    allRelevantDocs.push(...relevantDocs);
  }));
  return allRelevantDocs;
}

// Функция для переранжирования документов с использованием внешнего reranker сервиса
async function rerankDocuments(question, relevantDocs) {
  try {
    // Логируем исходные документы и их рейтинги
    logger.info('Original documents ranking:');
    relevantDocs.forEach((doc, index) => {
      logger.info(`${index + 1}. ${doc.filename} (similarity: ${doc.similarity.toFixed(4)})`);
    });

    logger.info('Sending documents to reranker service');
    const response = await fetch('http://reranker:8001/rerank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: question,
        documents: relevantDocs
      })
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error(`Reranker service error: ${error}`);
      // Если reranker недоступен, возвращаем оригинальные документы
      return relevantDocs;
    }

    const data = await response.json();
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
      
      // Уже не вычисляем среднее изменение similarity, так как шкалы несопоставимы
      // logger.info(`Average similarity change: ${(totalSimilarityChange / rerankedDocs.length).toFixed(4)}`);
      
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
    logger.error('Error calling reranker service:', error);
    // В случае ошибки возвращаем оригинальные документы
    return relevantDocs;
  }
}

/**
 * @swagger
 * /ai/rag:
 *   post:
 *     tags: [AI]
 *     summary: RAG-enhanced completion
 *     description: Generate answer using Retrieval Augmented Generation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RagRequest'
 *     responses:
 *       200:
 *         description: Generated answer with context
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 answer:
 *                   type: string
 *                   description: Generated answer
 *                 context:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       filename:
 *                         type: string
 *                       content:
 *                         type: string
 *                       similarity:
 *                         type: number
 *       404:
 *         description: No relevant documents found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/rag', async (req, res) => {
  const { question, project, model, useReranker = true } = req.body;

  if (!question || !project || !model) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    logger.info('POST /ai/rag request received:', {
      question,
      project,
      model,
      useReranker
    });

    // Проверяем, не является ли выбранная модель моделью для эмбеддингов
    if (model === 'all-minilm' || model === 'all-minilm:latest' || 
        model === process.env.EMBEDDING_MODEL || 
        (process.env.EMBEDDING_MODEL && model === `${process.env.EMBEDDING_MODEL}:latest`)) {
      return res.status(400).json({ 
        error: 'Invalid model selection',
        details: `"${model}" is an embedding model and cannot be used for text generation. Please select a text generation model.`
      });
    }

    const relevantDocs = await getRelevantChunks(question, project, model);
    
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

    logger.info('Found relevant documents:', relevantDocs.map(doc => doc.filename));

    // Логируем первоначальный контекст
    const originalContext = relevantDocs.map((doc, index) => `${index + 1}. Из документа ${doc.filename}:\n${doc.content.trim()}`).join('\n\n');
    logger.info('Original context order:');
    relevantDocs.forEach((doc, index) => {
      // Выводим только первые 100 символов содержимого для более компактных логов
      const contentPreview = doc.content.trim().substring(0, 100) + (doc.content.length > 100 ? '...' : '');
      logger.info(`${index + 1}. ${doc.filename} (similarity: ${doc.similarity.toFixed(4)}): ${contentPreview}`);
    });

    // Добавляем шаг переранжирования, если параметр useReranker включен
    let processedDocs = relevantDocs;
    if (useReranker) {
      logger.info('Applying reranking to documents');
      processedDocs = await rerankDocuments(question, relevantDocs);
      logger.info('Documents reranked');

      // Логируем контекст после реранкинга
      logger.info('Reranked context order:');
      processedDocs.forEach((doc, index) => {
        // Выводим только первые 100 символов содержимого для более компактных логов
        const contentPreview = doc.content.trim().substring(0, 100) + (doc.content.length > 100 ? '...' : '');
        logger.info(`${index + 1}. ${doc.filename} (similarity: ${doc.similarity.toFixed(4)}): ${contentPreview}`);
      });
    }

    const context = `Найденные релевантные фрагменты:\n\n${processedDocs.map((doc, index) => `${index + 1}. Из документа ${doc.filename}:\n${doc.content.trim()}`).join('\n\n')}\n\nНа основе этих фрагментов, пожалуйста, ответь на вопрос пользователя. Если информации недостаточно, так и скажи.`;

    logger.info('Getting answer from LLM...');
    // Получаем ответ от LLM
    const answer = await getCompletion([
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
    ], model);

    logger.info('Sending response to client');
    res.json({
      answer,
      relevantDocuments: processedDocs.map(doc => ({
        filename: doc.filename,
        similarity: doc.similarity,
        project: doc.project
      })),
      originalDocuments: originalDocs // Добавляем исходные документы для сравнения
    });

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
 *     tags: [AI]
 *     summary: Get relevant document chunks
 *     description: Retrieve relevant document chunks for a question
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
 *                 description: User question
 *               project:
 *                 type: string
 *                 description: Project name
 *               limit:
 *                 type: integer
 *                 description: Maximum number of chunks to return
 *     responses:
 *       200:
 *         description: List of relevant document chunks
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
 *                       content:
 *                         type: string
 *                       similarity:
 *                         type: number
 *       404:
 *         description: No relevant documents found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/rag/chunks', async (req, res) => {
  const { question, project, limit } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'Missing required parameters: question' });
  }

  try {
    logger.info('POST /ai/rag/chunks request received:', { question, project, limit });
    const relevantDocs = await getRelevantChunks(question, project, null, limit ? Number(limit) : undefined);
    if (relevantDocs.length === 0) {
      logger.info('No relevant documents found');
      return res.status(404).json({ error: 'No relevant documents found for this question' });
    }
    logger.info('Found relevant documents:', relevantDocs.map(doc => doc.filename));
    res.json({ relevantDocuments: relevantDocs });
  } catch (error) {
    logger.error('Error in ai/rag/chunks:', error);
    res.status(500).json({ error: 'Failed to get relevant documents', details: error.message });
  }
});

export default router;
