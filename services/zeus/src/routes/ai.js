import express from 'express';
import fetch from 'node-fetch';
import logger from '../utils/logger.js';
import { resolveOllamaBaseUrlForModel, resolveOllamaInstanceForModel } from '../utils/ollama.js';
import { beginInFlight } from '../utils/inflight.js';
import { forwardToFriendly, pickExecutionTarget } from '../utils/friendlyRouting.js';
import { runOllamaLimited, runVllmLimited } from '../utils/providerLimits.js';
import {
  buildVllmChatCompletionPayload,
  callVllmChatCompletions,
  forwardToVllm,
  getVllmCompletionMaxTokens,
  getVllmMaxModelLen,
  getVllmTargetForModel,
} from '../utils/vllm.js';
import { stripThinkingContent } from '../utils/ragText.js';
import { searchDocuments } from '../services/retrieval.js';
import {
  buildRagContextFromDocs,
  buildRagMessages
} from '../utils/ragPrompt.js';

const router = express.Router();

function normalizeOllamaKeepAlive(value, fallback = '-1m') {
  const normalized = String(value || fallback).trim();
  return normalized === '-1' ? '-1m' : normalized;
}

const DEFAULT_COMPLETION_MAX_TOKENS = Math.max(1, Number(process.env.DEFAULT_COMPLETION_MAX_TOKENS) || 8192);
const DEFAULT_OLLAMA_NUM_CTX = Math.max(512, Number(process.env.DEFAULT_OLLAMA_NUM_CTX) || 4096);
const OLLAMA_KEEP_ALIVE = normalizeOllamaKeepAlive(process.env.OLLAMA_KEEP_ALIVE);
const RAG_ANSWER_MAX_TOKENS = Math.max(1, Number(process.env.RAG_ANSWER_MAX_TOKENS) || 1024);
const RAG_ANSWER_TEMPERATURE = Number.isFinite(Number(process.env.RAG_ANSWER_TEMPERATURE))
  ? Number(process.env.RAG_ANSWER_TEMPERATURE)
  : 0.2;
const RAG_ANSWER_TOP_P = Number.isFinite(Number(process.env.RAG_ANSWER_TOP_P))
  ? Number(process.env.RAG_ANSWER_TOP_P)
  : 0.9;
const RAG_CONTEXT_CHAR_LIMIT = Math.max(0, Number(process.env.RAG_CONTEXT_CHAR_LIMIT) || 6000);
const RAG_VLLM_ANSWER_MAX_TOKENS = Math.max(1, Number(process.env.RAG_VLLM_ANSWER_MAX_TOKENS) || 1024);
const RAG_VLLM_CONTEXT_CHAR_LIMIT = Math.max(0, Number(process.env.RAG_VLLM_CONTEXT_CHAR_LIMIT) || 2200);

const VLLM_CHAT_PAYLOAD_FIELDS = [
  'model',
  'messages',
  'stream',
  'temperature',
  'top_p',
  'max_tokens',
  'presence_penalty',
  'frequency_penalty',
  'stop',
  'n',
  'seed',
  'user',
  'logprobs',
  'top_logprobs',
  'response_format',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'chat_template_kwargs'
];

function buildVllmChatPayload(body, model) {
  const payload = {};
  for (const field of VLLM_CHAT_PAYLOAD_FIELDS) {
    if (body && body[field] !== undefined) {
      payload[field] = body[field];
    }
  }
  payload.model = model;
  return buildVllmChatCompletionPayload({
    ...payload,
    think: body?.think
  });
}

function extractThinkingSection(response) {
  if (!response || typeof response !== 'string') {
    return { answer: response, thinking: null };
  }

  // Ищем секции <think>...</think> (возможны вариации: thinking, анализ и т.д.)
  const thinkingRegex = /<(?:think|thinking|анализ|размышление)[^>]*>([\s\S]*?)<\/(?:think|thinking|анализ|размышление)>/gi;
  
  let thinking = null;
  let cleanedResponse = stripThinkingContent(response);
  
  // Извлекаем все секции размышлений
  const matches = [...response.matchAll(thinkingRegex)];
  
  if (matches.length > 0) {
    // Собираем все размышления в один блок
    thinking = matches.map(match => match[1].trim()).join('\n\n---\n\n');
    
    // Удаляем все теги размышлений из основного ответа
    cleanedResponse = stripThinkingContent(response);
    
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
async function getCompletion(messages, model, think = true, options = {}) {
  const requestedMaxTokens = Number(options.maxTokens);
  const maxTokens = Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
    ? Math.floor(requestedMaxTokens)
    : DEFAULT_COMPLETION_MAX_TOKENS;
  const requestedTemperature = Number(options.temperature);
  const temperature = Number.isFinite(requestedTemperature) ? requestedTemperature : 0.7;
  const requestedTopP = Number(options.topP ?? options.top_p);
  const topP = Number.isFinite(requestedTopP) ? requestedTopP : undefined;

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
          temperature,
          ...(topP !== undefined ? { top_p: topP } : {}),
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
      const vllmTarget = await getVllmTargetForModel(actualModel);
      if (vllmTarget) {
        const vllmMaxTokens = getVllmCompletionMaxTokens(vllmTarget.status, maxTokens, RAG_VLLM_ANSWER_MAX_TOKENS);
        const data = await runVllmLimited({ model: actualModel, label: 'complete' }, async () => {
          const response = await callVllmChatCompletions(buildVllmChatCompletionPayload({
            model: vllmTarget.model,
            messages,
            stream: false,
            temperature,
            ...(topP !== undefined ? { top_p: topP } : {}),
            max_tokens: vllmMaxTokens,
            think
          }));
          return response.json();
        });

        if (!data.choices || !data.choices.length) {
          throw new Error(`vLLM API returned invalid response format: missing choices array. Response: ${JSON.stringify(data)}`);
        }

        const llmResponse = data.choices[0].message.content;
        logger.info('LLM Response from vLLM:', {
          model: actualModel,
          service: 'vLLM',
          maxTokens: vllmMaxTokens,
          responseLength: llmResponse.length,
          response: llmResponse
        });

        return llmResponse;
      }

      const inst = await resolveOllamaInstanceForModel(actualModel);
      const ollamaBaseUrl = inst?.baseUrl || await resolveOllamaBaseUrlForModel(actualModel);
      const data = await runOllamaLimited({ instanceId: inst?.id ?? null, model: actualModel, label: 'complete' }, async () => {
        const response = await fetch(`${ollamaBaseUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: actualModel,
            messages: messages,
            stream: false,
            options: {
              num_ctx: DEFAULT_OLLAMA_NUM_CTX,
              num_predict: maxTokens,
              temperature,
              ...(topP !== undefined ? { top_p: topP } : {})
            },
            keep_alive: OLLAMA_KEEP_ALIVE,
            think: think
          })
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Ollama API error: ${error}`);
        }

        return response.json();
      });

      const llmResponse = data?.message?.content ?? data?.response ?? '';
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
    // Friendly routing (only for local Ollama embedding models)
    const target = await pickExecutionTarget({ model, req });
    if (target.type === 'friendly') {
      logger.info('Forwarding embedding request to friendly server', {
        model,
        target: target.server?.name || target.server?.base_url,
        debug: target.debug,
      });
      await forwardToFriendly({ req, res, server: target.server, path: '/api/ai/embed', timeoutMs: 180_000 });
      return;
    }

    res.setHeader('X-Ollamify-Executed-On', 'local');

    const inst = await resolveOllamaInstanceForModel(model);
    const endInFlight = beginInFlight({ instanceId: inst?.id ?? null, model, label: 'embed' });

    // Убедимся, что input всегда массив
    const inputs = Array.isArray(input) ? input : [input];

    const ollamaBaseUrl = inst?.baseUrl || await resolveOllamaBaseUrlForModel(model);
    
    try {
      // Получаем эмбеддинги для каждого текста
      const embeddings = await runOllamaLimited({ instanceId: inst?.id ?? null, model, label: 'embed' }, async () => {
        const result = [];
        for (const text of inputs) {
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
          result.push(data.embedding);
        }
        return result;
      });

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
    } finally {
      endInFlight();
    }
  } catch (error) {
    logger.error('Error getting embedding:', error);
    res.status(error.statusCode || 500).json({
      error: {
        message: error.message,
        type: 'invalid_request_error',
        code: error.code || null
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

    const localIsOpenRouter = model.startsWith('openrouter/');
    const vllmTarget = localIsOpenRouter ? null : await getVllmTargetForModel(model);
    if (vllmTarget) {
      logger.info('Forwarding completion request to vLLM', {
        model,
        resolvedModel: vllmTarget.model,
        stream
      });

      const vllmReq = {
        ...req,
        body: buildVllmChatPayload(req.body, vllmTarget.model)
      };

      await runVllmLimited({ model, label: stream ? 'complete_stream' : 'complete' }, async () => {
        await forwardToVllm({ req: vllmReq, res, path: '/v1/chat/completions', timeoutMs: 600_000 });
      });
      return;
    }

    // Friendly routing (only for local Ollama models; OpenRouter stays local)
    const target = await pickExecutionTarget({ model, req });
    if (target.type === 'friendly') {
      logger.info('Forwarding completion request to friendly server', {
        model,
        stream,
        target: target.server?.name || target.server?.base_url,
        debug: target.debug,
      });
      await forwardToFriendly({ req, res, server: target.server, path: '/api/ai/complete', timeoutMs: 600_000 });
      return;
    }

    res.setHeader('X-Ollamify-Executed-On', 'local');

    if (stream) {
      // Устанавливаем заголовки для SSE
      // Пока не поддерживаем стриминг для OpenRouter
      if (model.startsWith('openrouter/')) {
        throw new Error('Streaming is not supported for OpenRouter models');
      }

      const inst = await resolveOllamaInstanceForModel(model);
      const endInFlight = beginInFlight({ instanceId: inst?.id ?? null, model, label: 'complete_stream' });

      try {
        await runOllamaLimited({ instanceId: inst?.id ?? null, model, label: 'complete_stream' }, async () => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const ollamaBaseUrl = inst?.baseUrl || await resolveOllamaBaseUrlForModel(model);
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

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Ollama API error: ${error}`);
        }

        // Стриминг Ollama: JSON lines. Собираем буфер и парсим построчно.
        const decoder = new TextDecoder();
        let buffer = '';
        const streamId = 'chatcmpl-' + Math.random().toString(36).slice(2, 11);
        const created = Math.floor(Date.now() / 1000);
        let sentRole = false;

        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let data;
            try {
              data = JSON.parse(trimmed);
            } catch (e) {
              logger.error('Error parsing Ollama streaming line:', e);
              continue;
            }

            if (!sentRole) {
              sentRole = true;
              const roleChunk = {
                id: streamId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [{
                  index: 0,
                  delta: { role: 'assistant' },
                  finish_reason: null
                }]
              };
              res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);
            }

            if (data?.response) {
              const openAIChunk = {
                id: streamId,
                object: 'chat.completion.chunk',
                created,
                model: model,
                choices: [{
                  index: 0,
                  delta: {
                    content: data.response
                  },
                  finish_reason: null
                }]
              };
              res.write(`data: ${JSON.stringify(openAIChunk)}\n\n`);
            }

            if (data?.done) {
              // Завершаем поток в стиле OpenAI
              const finalChunk = {
                id: streamId,
                object: 'chat.completion.chunk',
                created,
                model: model,
                choices: [{
                  index: 0,
                  delta: {},
                  finish_reason: 'stop'
                }]
              };
              res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
          }
        }

        // Flush last buffered line if any
        const tail = buffer.trim();
        if (tail) {
          try {
            const data = JSON.parse(tail);
            if (data?.response) {
              const openAIChunk = {
                id: streamId,
                object: 'chat.completion.chunk',
                created,
                model: model,
                choices: [{
                  index: 0,
                  delta: { content: data.response },
                  finish_reason: null
                }]
              };
              res.write(`data: ${JSON.stringify(openAIChunk)}\n\n`);
            }
          } catch {
            // ignore
          }
        }

        res.write('data: [DONE]\n\n');
        res.end();
        });
      } finally {
        endInFlight();
      }
    } else {
      const localIsOpenRouter = model.startsWith('openrouter/');
      const endInFlight = !localIsOpenRouter
        ? beginInFlight({ instanceId: (await resolveOllamaInstanceForModel(model))?.id ?? null, model, label: 'complete' })
        : null;

      try {
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
      } finally {
        if (endInFlight) endInFlight();
      }
    }
  } catch (error) {
    logger.error('Error in completion:', error);
    if (res.headersSent) {
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }
    res.status(error.statusCode || 500).json({
      error: {
        message: error.message,
        type: 'invalid_request_error',
        code: error.code || null
      }
    });
  }
});

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
  const { question, project, model, useReranker = true, limit = 30, think = true, useHybridSearch, mode } = req.body;

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
    const numLimit = limit ? Number(limit) : 30;
    const searchResult = await searchDocuments({
      query: question,
      project,
      model,
      mode,
      useHybridSearch: hybridEnabled,
      useReranker,
      smartSelect: true,
      includeAdjacentChunks: true,
      limit: numLimit,
      completionProvider: getCompletion
    });

    let processedDocs = searchResult.relevantDocuments;
    const originalDocs = searchResult.originalDocuments;
    const intentQuery = searchResult.intentQuery;

    logger.info('Query retrieval summary:', {
      originalQuery: question,
      extractedIntent: intentQuery,
      model,
      keywords: searchResult.keywords,
      mode: searchResult.mode,
      useHybridSearch: hybridEnabled,
      useReranker,
      returnedDocuments: processedDocs.length
    });

    if (processedDocs.length === 0) {
      logger.info('No relevant documents found');
      return res.status(404).json({
        error: 'No relevant documents found for this question'
      });
    }

    logger.info(`Found ${processedDocs.length} processed documents using intent query with limit=${numLimit}:`, processedDocs.map(doc => doc.filename));
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

    const vllmTargetForRag = await getVllmTargetForModel(model);
    const vllmMaxModelLen = vllmTargetForRag ? getVllmMaxModelLen(vllmTargetForRag.status) : null;
    const ragContextCharLimit = vllmTargetForRag && vllmMaxModelLen && vllmMaxModelLen <= 4096
      ? RAG_VLLM_CONTEXT_CHAR_LIMIT
      : RAG_CONTEXT_CHAR_LIMIT;
    const contextForLlm = ragContextCharLimit > 0
      ? buildRagContextFromDocs(processedDocs, ragContextCharLimit)
      : context;

    if (ragContextCharLimit > 0) {
      logger.info('Applied RAG context limit:', {
        model,
        maxModelLen: vllmMaxModelLen,
        contextLength: contextForLlm.length,
        originalContextLength: context.length,
        contextLimit: ragContextCharLimit
      });
    }
    
    // Логируем полный контекст, который отправляется в LLM
    logger.info('FULL CONTEXT FOR LLM:');
    logger.info(contextForLlm);
    
    logger.info('Getting answer from LLM...');
    // Для получения ответа используем оригинальный запрос пользователя
    const rawAnswer = await getCompletion(buildRagMessages({
      question,
      context: contextForLlm
    }), model, think, {
      maxTokens: vllmTargetForRag ? RAG_VLLM_ANSWER_MAX_TOKENS : RAG_ANSWER_MAX_TOKENS,
      temperature: RAG_ANSWER_TEMPERATURE,
      topP: RAG_ANSWER_TOP_P
    });

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
        document_id: doc.document_id,
        chunk_index: doc.chunk_index,
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
  const {
    question,
    project,
    model,
    limit = 100,
    useHybridSearch,
    mode,
    useReranker = false,
    includeAdjacentChunks = false,
    minScore,
    keywords
  } = req.body;

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
      useHybridSearch: hybridEnabled,
      mode,
      useReranker,
      includeAdjacentChunks,
      minScore
    });

    const numLimit = limit ? Number(limit) : 100;
    const searchResult = await searchDocuments({
      query: question,
      project,
      model,
      mode,
      useHybridSearch: hybridEnabled,
      useReranker,
      includeAdjacentChunks,
      minScore,
      keywords,
      limit: numLimit,
      completionProvider: getCompletion
    });

    if (searchResult.relevantDocuments.length === 0) {
      logger.info('No relevant documents found for chunks');
      return res.status(404).json({
        error: 'No relevant documents found for this question'
      });
    }

    logger.info(`Found ${searchResult.relevantDocuments.length} relevant documents with limit=${numLimit}`);
    logger.info('Sending chunks to client');
    res.json({
      relevantDocuments: searchResult.relevantDocuments,
      originalDocuments: searchResult.originalDocuments,
      intentQuery: searchResult.intentQuery,
      keywords: searchResult.keywords,
      mode: searchResult.mode,
      limitApplied: searchResult.limitApplied
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
