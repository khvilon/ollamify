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
          max_tokens: 1024
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenRouter API error: ${error}`);
      }

      const data = await response.json();
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
          stream: false
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

// Получение completion от модели в формате OpenAI API
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

// RAG (Retrieval Augmented Generation) endpoint
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

    // Получаем модель для эмбеддингов из проекта
    const projectResult = await pool.query(
      'SELECT embedding_model FROM admin.projects WHERE name = $1',
      [project]
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const embeddingModel = projectResult.rows[0].embedding_model;
    
    // Используем модель из проекта для эмбеддингов
    logger.info('Getting embedding for question:', question);
    const questionEmbedding = await getEmbedding(question, embeddingModel);
    
    // Ищем релевантные документы в конкретном проекте
    logger.info('Finding relevant documents in project:', project);
    const relevantDocs = await findRelevantDocuments(questionEmbedding, project, embeddingModel);
    
    if (relevantDocs.length === 0) {
      logger.info('No relevant documents found');
      return res.status(404).json({ 
        error: 'No relevant documents found for this question' 
      });
    }

    logger.info('Found relevant documents:', relevantDocs.map(doc => doc.filename));

    const context = `Найденные релевантные фрагменты:\n\n` + 
    relevantDocs
      .map((doc, index) => `${index + 1}. Из документа ${doc.filename}:\n${doc.content.trim()}`)
      .join('\n\n') +
    '\n\nНа основе этих фрагментов, пожалуйста, ответь на вопрос пользователя. Если информации недостаточно, так и скажи.';

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
        similarity: doc.similarity
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

export default router;
