import express from 'express';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import crypto from 'crypto';
import logger from '../utils/logger.js';

const router = express.Router();

// Кэш для моделей
let modelsCache = null;
let openRouterModelsCache = null;
let lastCacheUpdate = null;
let lastOpenRouterCacheUpdate = null;

// Интервал обновления кэша (1 час)
const CACHE_UPDATE_INTERVAL = 60 * 60 * 1000;

// Хранилище статусов скачивания моделей
const modelDownloadStatus = new Map();

// Функция для парсинга относительного времени в дни
function parseRelativeTime(timeStr) {
  const match = timeStr.match(/(\d+)\s+(day|week|month|year)s?\s+ago/);
  if (!match) return 0;
  
  const [_, num, unit] = match;
  const days = {
    day: 1,
    week: 7,
    month: 30,
    year: 365
  };
  
  return parseInt(num) * days[unit];
}

// Функция для получения списка моделей с ollama.com
async function fetchOllamaModels() {
  try {
    // Если кэш существует и прошло меньше часа с последнего обновления, возвращаем кэш
    if (modelsCache && lastCacheUpdate && (Date.now() - lastCacheUpdate) < CACHE_UPDATE_INTERVAL) {
      logger.info('Returning models from cache');
      return modelsCache;
    }

    logger.info('Fetching models from ollama.com');
    const response = await fetch('https://ollama.com/search');
    
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }
    
    const html = await response.text();
    
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    const modelElements = document.querySelectorAll('[x-test-model]');
    logger.info(`Found ${modelElements.length} model elements`);

    if (!modelElements || modelElements.length === 0) {
      logger.warn('No model elements found on the page');
      // Если не удалось получить новые данные, возвращаем кэш, если он есть
      if (modelsCache) {
        return modelsCache;
      }
      return []; // Возвращаем пустой массив, если нет ни данных, ни кэша
    }

    const models = [];
    modelElements.forEach(modelEl => {
      try {
        const title = modelEl.querySelector('[x-test-search-response-title]')?.textContent;
        if (!title) {
          logger.warn('Skipping model element without title');
          return;
        }

        const description = modelEl.querySelector('p.max-w-lg')?.textContent || '';
        const pullCount = modelEl.querySelector('[x-test-pull-count]')?.textContent || '0';
        const tagCount = modelEl.querySelector('[x-test-tag-count]')?.textContent || '0';
        const updated = modelEl.querySelector('[x-test-updated]')?.textContent || '';
        
        const capabilities = Array.from(modelEl.querySelectorAll('[x-test-capability]'))
          .map(el => el.textContent)
          .filter(Boolean);

        const sizes = Array.from(modelEl.querySelectorAll('[x-test-size]'))
          .map(el => el.textContent?.trim())
          .filter(Boolean);
        
        // Конвертируем pullCount в число
        const pulls = pullCount.replace(/[KMB]/g, x => ({
          'K': '000',
          'M': '000000',
          'B': '000000000'
        }[x])).replace('.', '');
        
        // Конвертируем updated в дни
        const daysAgo = parseRelativeTime(updated);

        models.push({
          name: title,
          description,
          pulls: parseInt(pulls || '0'),
          tags: parseInt(tagCount || '0'),
          updated_days_ago: daysAgo,
          capabilities,
          sizes
        });
      } catch (error) {
        logger.error('Error parsing model element:', error);
      }
    });

    logger.info(`Successfully parsed ${models.length} models`);

    // Обновляем кэш только если получили какие-то данные
    if (models.length > 0) {
      modelsCache = models;
      lastCacheUpdate = Date.now();
      logger.info('Models cache updated');
    } else if (modelsCache) {
      logger.info('Using cached models due to empty parse result');
      return modelsCache;
    }

    return models;
  } catch (error) {
    logger.error('Error fetching Ollama models:', error);
    // В случае ошибки возвращаем кэш, если он есть
    if (modelsCache) {
      logger.info('Returning cached models due to fetch error');
      return modelsCache;
    }
    return []; // Возвращаем пустой массив, если нет ни данных, ни кэша
  }
}

// Функция для получения списка моделей с OpenRouter
async function fetchOpenRouterModels() {
  try {
    // Если кэш существует и прошло меньше часа с последнего обновления, возвращаем кэш
    if (openRouterModelsCache && lastOpenRouterCacheUpdate && (Date.now() - lastOpenRouterCacheUpdate) < CACHE_UPDATE_INTERVAL) {
      logger.info('Returning OpenRouter models from cache');
      return openRouterModelsCache;
    }

    logger.info('Fetching models from OpenRouter');
    const response = await fetch('https://openrouter.ai/api/v1/models');
    
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenRouter models: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Преобразуем данные в более удобный формат
    const models = data.data.map(model => ({
      id: model.id, // Используем оригинальный ID модели (например, "microsoft/phi-4")
      name: model.name,
      description: model.description,
      context_length: model.context_length,
      pricing: model.pricing,
      modality: model.modality,
      updated_at: model.updated_at,
      group: model.group
    }));

    // Обновляем кэш
    openRouterModelsCache = models;
    lastOpenRouterCacheUpdate = Date.now();

    return models;
  } catch (error) {
    logger.error('Error fetching OpenRouter models:', error);
    // Если не удалось получить новые данные, возвращаем кэш, если он есть
    if (openRouterModelsCache) {
      return openRouterModelsCache;
    }
    return []; // Возвращаем пустой массив, если нет ни данных, ни кэша
  }
}

// Функция для проверки статуса модели в Ollama
async function checkModelStatus(modelName) {
  try {
    const response = await fetch('http://ollama:11434/api/pull', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: modelName, stream: true })
    });

    if (!response.ok) {
      throw new Error(`Failed to check model status: ${response.statusText}`);
    }

    // Читаем поток ответа
    for await (const chunk of response.body) {
      const lines = chunk.toString().split('\n').filter(Boolean);
      
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.status === 'success') {
            modelDownloadStatus.set(modelName, {
              status: 'ready',
              progress: 100,
              message: 'Model is ready'
            });
            return;
          }
          
          // Обновляем статус скачивания
          if (data.completed && data.total) {
            const progress = Math.round((data.completed / data.total) * 100);
            modelDownloadStatus.set(modelName, {
              status: 'downloading',
              progress,
              message: `Downloading: ${progress}%`
            });
          }
        } catch (e) {
          logger.error('Error parsing status line:', e);
        }
      }
    }
  } catch (error) {
    logger.error(`Error checking status for ${modelName}:`, error);
    modelDownloadStatus.set(modelName, {
      status: 'error',
      progress: 0,
      message: error.message
    });
  }
}

// Функция для запуска мониторинга скачивания модели
function startModelMonitoring(modelName) {
  // Устанавливаем начальный статус
  modelDownloadStatus.set(modelName, {
    status: 'starting',
    progress: 0,
    message: 'Starting download'
  });

  // Запускаем периодическую проверку
  const intervalId = setInterval(async () => {
    const status = modelDownloadStatus.get(modelName);
    
    // Прекращаем мониторинг, если модель готова или произошла ошибка
    if (status && (status.status === 'ready' || status.status === 'error')) {
      clearInterval(intervalId);
      return;
    }

    await checkModelStatus(modelName);
  }, 1000);

  // Сохраняем ID интервала для возможной очистки
  modelDownloadStatus.get(modelName).intervalId = intervalId;
}

// Функция для получения релевантного контекста из документов
async function getRelevantContext(question) {
    try {
        const response = await fetch('http://ollama:11434/api/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama2',
                prompt: question
            })
        });

        if (!response.ok) {
            throw new Error('Failed to get embeddings');
        }

        const data = await response.json();
        // TODO: Здесь будет логика поиска релевантных документов
        return "";
    } catch (error) {
        logger.error('Error getting embeddings:', error);
        throw error;
    }
}

// Функция для получения ответа от модели
async function getAnswer(context, question) {
    try {
        const response = await fetch(process.env.OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: process.env.OPENROUTER_MODEL,
                messages: [
                    {
                        role: "system",
                        content: "You are a helpful assistant that answers questions based on the provided documents. Use only the information from the context."
                    },
                    {
                        role: "user",
                        content: `Context:\n${context}\n\nQuestion: ${question}`
                    }
                ]
            })
        });

        if (!response.ok) {
            throw new Error('Failed to get answer from model');
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || 'No answer provided';
    } catch (error) {
        logger.error('Error getting answer:', error);
        throw error;
    }
}

// Инициализация статуса загрузки моделей при старте сервера
async function initializeModelStatus() {
  try {
    logger.info('Initializing model status...');
    const response = await fetch('http://ollama:11434/api/pull', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: 'status' })
    });

    if (!response.ok) {
      throw new Error(`Failed to check model status: ${response.statusText}`);
    }

    // Читаем поток ответа построчно
    for await (const chunk of response.body) {
      const lines = chunk.toString().split('\n').filter(Boolean);
      
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.status === 'downloading') {
            logger.info(`Found active download for model: ${data.model}`);
            modelDownloadStatus.set(data.model, {
              status: 'downloading',
              progress: Math.round((data.completed / data.total) * 100),
              message: `Downloading: ${Math.round((data.completed / data.total) * 100)}%`
            });
            startModelMonitoring(data.model);
          }
        } catch (e) {
          // Игнорируем ошибки парсинга - некоторые строки могут быть не JSON
          continue;
        }
      }
    }

    logger.info('Model status initialization completed');
  } catch (error) {
    logger.error('Error initializing model status:', error);
  }
}

// Запускаем инициализацию при старте сервера
initializeModelStatus();

// Инициализация кэша при запуске
fetchOllamaModels().catch(logger.error);
fetchOpenRouterModels().catch(logger.error);

// Периодическое обновление кэша
setInterval(() => {
  fetchOllamaModels().catch(logger.error);
  fetchOpenRouterModels().catch(logger.error);
}, CACHE_UPDATE_INTERVAL);

// Получение списка моделей
router.get('/', async (req, res) => {
  try {
    // Получаем список установленных моделей
    const response = await fetch('http://ollama:11434/api/tags');
    const data = await response.json();
    
    // Получаем список доступных моделей для обогащения данных
    const availableModels = await fetchOllamaModels();
    
    // Преобразуем установленные модели и добавляем статус
    const models = (data.models || []).map(model => {
      const downloadStatus = modelDownloadStatus.get(model.name) || {
        status: 'ready',
        progress: 100,
        message: 'Model is ready'
      };

      // Находим соответствующую модель в списке доступных только если нет description
      let description = model.description;
      let capabilities = model.capabilities || [];

      if (!description || !capabilities.length) {
        const baseModelName = model.name.split(/[:\/]/)[0];
        const availableModel = availableModels.find(m => {
          const availableBaseName = m.name.split(/[:\/]/)[0];
          return availableBaseName === baseModelName;
        });

        description = description || availableModel?.description || 'No description available';
        capabilities = capabilities.length ? capabilities : (availableModel?.capabilities || []);
      }

      return {
        ...model,
        description,
        capabilities,
        downloadStatus
      };
    });

    // Добавляем модели, которые сейчас скачиваются, но еще не установлены
    for (const [modelName, status] of modelDownloadStatus.entries()) {
      // Пропускаем модели, которые уже есть в списке установленных
      if (!models.some(m => m.name === modelName)) {
        // Находим соответствующую модель в списке доступных
        const baseModelName = modelName.split(/[:\/]/)[0];
        const availableModel = availableModels.find(m => {
          const availableBaseName = m.name.split(/[:\/]/)[0];
          return availableBaseName === baseModelName;
        });

        models.push({
          name: modelName,
          description: availableModel?.description || 'No description available',
          capabilities: availableModel?.capabilities || [],
          downloadStatus: status
        });
      }
    }

    // Оборачиваем массив моделей в объект
    res.json({ models });
  } catch (error) {
    logger.error('Error getting models:', error);
    res.status(500).json({ error: error.message });
  }
});

// Получение списка доступных для скачивания моделей
router.get('/available', async (req, res) => {
  try {
    // Получаем список установленных моделей
    const response = await fetch('http://ollama:11434/api/tags');
    const data = await response.json();
    
    // Получаем список моделей с ollama.com
    const availableModels = await fetchOllamaModels();
    
    // Фильтруем уже установленные модели
    const installedModels = new Set(data.models.map(m => m.name));
    const availableForDownload = availableModels.filter(m => !installedModels.has(m.name));
    
    res.json({ models: availableForDownload });
  } catch (error) {
    logger.error('Error fetching available models:', error);
    res.status(500).json({ error: error.message });
  }
});

// Эндпоинт для получения списка всех моделей (Ollama + OpenRouter)
router.get('/models', async (req, res) => {
  try {
    const [ollamaModels, openRouterModels] = await Promise.all([
      fetchOllamaModels(),
      fetchOpenRouterModels()
    ]);

    const installedModels = await fetch('http://ollama:11434/api/tags')
      .then(response => response.json())
      .then(data => data.models || [])
      .catch(() => []);

    res.json({
      models: {
        installed: installedModels,
        available: {
          ollama: ollamaModels,
          openrouter: openRouterModels
        }
      }
    });
  } catch (error) {
    logger.error('Error fetching models:', error);
    res.status(500).json({ error: error.message });
  }
});

// Запуск скачивания модели
router.post('/pull', async (req, res) => {
  const { name, size } = req.body;
  
  try {
    logger.info(`Starting to pull model: ${name} (size: ${size})`);
    
    // Формируем полное имя модели с размером
    const modelName = size ? `${name}:${size}` : name;
    
    // Запускаем мониторинг скачивания
    startModelMonitoring(modelName);

    res.json({ 
      status: 'pulling',
      message: `Started pulling model: ${modelName}`,
      model: modelName
    });

  } catch (error) {
    logger.error('Error pulling model:', error);
    res.status(500).json({ error: error.message || 'Failed to pull model' });
  }
});

// Проверка статуса модели
router.get('/status/:name', async (req, res) => {
  const { name } = req.params;
  
  try {
    // Проверяем статус модели через show
    const response = await fetch('http://ollama:11434/api/show', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name })
    });

    if (!response.ok) {
      throw new Error(`Failed to get model status: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Проверяем, установлена ли модель
    if (data.modelfile) {
      res.json({ 
        status: 'ready',
        message: `Model ${name} is ready`,
        details: data
      });
    } else {
      res.json({ 
        status: 'not_found',
        message: `Model ${name} is not installed`,
      });
    }

  } catch (error) {
    logger.error('Error checking model status:', error);
    res.status(500).json({ error: error.message || 'Failed to check model status' });
  }
});

// Удаление модели
router.delete('/:name', async (req, res) => {
  const { name } = req.params;
  
  try {
    const response = await fetch('http://ollama:11434/api/delete', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    });
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('Error deleting model:', error);
    res.status(500).json({ error: error.message });
  }
});

// Эндпоинт для получения ответа на вопрос
router.post('/chat/answer', async (req, res) => {
    const { question } = req.body;

    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }

    try {
        // Получаем релевантный контекст
        const context = await getRelevantContext(question);

        // Получаем ответ от модели
        const answer = await getAnswer(context, question);

        res.json({ answer });
    } catch (error) {
        logger.error('Error processing question:', error);
        res.status(500).json({ error: error.message || 'Failed to get answer' });
    }
});

export default router;
