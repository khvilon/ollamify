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
  const { question, project, model } = req.body;

  if (!question || !project || !model) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    logger.info('POST /ai/rag request received:', {
      question,
      project,
      model
    });

    const relevantDocs = await getRelevantChunks(question, project, model);
    
    if (relevantDocs.length === 0) {
      logger.info('No relevant documents found');
      return res.status(404).json({ 
        error: 'No relevant documents found for this question' 
      });
    }

    logger.info('Found relevant documents:', relevantDocs.map(doc => doc.filename));

    const context = `Найденные релевантные фрагменты:\n\n${relevantDocs.map((doc, index) => `${index + 1}. Из документа ${doc.filename}:\n${doc.content.trim()}`).join('\n\n')}\n\nНа основе этих фрагментов, пожалуйста, ответь на вопрос пользователя. Если информации недостаточно, так и скажи.`;

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
      relevantDocuments: relevantDocs.map(doc => ({
        filename: doc.filename,
        similarity: doc.similarity,
        project: doc.project
      }))
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
