import express from 'express';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import { broadcastModelUpdate } from '../websocket/index.js';
import { getOllamaInstances, refreshOllamaModelIndex, resolveOllamaInstanceForModel, fetchWithTimeout } from '../utils/ollama.js';

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
async function checkModelStatus(modelName, ollamaBaseUrl) {
  try {
    const response = await fetch(`${ollamaBaseUrl}/api/pull`, {
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
              message: 'Model is ready',
              gpu: modelDownloadStatus.get(modelName)?.gpu ?? 0
            });
            // Оповещаем через WebSocket
            broadcastModelUpdate({
              name: modelName,
              gpu: modelDownloadStatus.get(modelName)?.gpu ?? 0,
              downloadStatus: {
                status: 'ready',
                progress: 100,
                message: 'Model is ready'
              }
            });
            return;
          }
          
          // Обновляем статус скачивания
          if (data.completed && data.total) {
            const progress = Math.round((data.completed / data.total) * 100);
            modelDownloadStatus.set(modelName, {
              status: 'downloading',
              progress,
              message: `Downloading: ${progress}%`,
              gpu: modelDownloadStatus.get(modelName)?.gpu ?? 0
            });
            
            // Оповещаем через WebSocket
            broadcastModelUpdate({
              name: modelName,
              gpu: modelDownloadStatus.get(modelName)?.gpu ?? 0,
              downloadStatus: {
                status: 'downloading',
                progress,
                message: `Downloading: ${progress}%`
              }
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
      message: error.message,
      gpu: modelDownloadStatus.get(modelName)?.gpu ?? 0
    });
    
    // Оповещаем через WebSocket
    broadcastModelUpdate({
      name: modelName,
      gpu: modelDownloadStatus.get(modelName)?.gpu ?? 0,
      downloadStatus: {
        status: 'error',
        progress: 0,
        message: error.message
      }
    });
  }
}

// Функция для запуска мониторинга скачивания модели
function startModelMonitoring(modelName, ollamaBaseUrl) {
  // Устанавливаем начальный статус
  modelDownloadStatus.set(modelName, {
    status: 'starting',
    progress: 0,
    message: 'Starting download',
    gpu: modelDownloadStatus.get(modelName)?.gpu ?? 0
  });

  // Запускаем периодическую проверку
  const intervalId = setInterval(async () => {
    const status = modelDownloadStatus.get(modelName);
    
    // Прекращаем мониторинг, если модель готова или произошла ошибка
    if (status && (status.status === 'ready' || status.status === 'error')) {
      clearInterval(intervalId);
      return;
    }

    await checkModelStatus(modelName, ollamaBaseUrl);
  }, 1000);

  // Сохраняем ID интервала для возможной очистки
  modelDownloadStatus.get(modelName).intervalId = intervalId;
}



// Инициализация статуса загрузки моделей при старте сервера
async function initializeModelStatus() {
  try {
    logger.info('Initializing model status...');
    const primaryBaseUrl = (await getOllamaInstances())[0]?.baseUrl || 'http://ollama:11434';
    const response = await fetch(`${primaryBaseUrl}/api/pull`, {
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
              message: `Downloading: ${Math.round((data.completed / data.total) * 100)}%`,
              gpu: 0
            });
            startModelMonitoring(data.model, primaryBaseUrl);
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
    // Получаем список установленных моделей (со всех Ollama инстансов)
    const idx = await refreshOllamaModelIndex({ force: true });
    const installedRaw = [];

    for (const inst of idx.instances) {
      const instModels = idx.modelsByInstance.get(inst.id) || [];
      for (const model of instModels) {
        installedRaw.push({
          ...model,
          gpu: inst.id,
          gpu_label: inst.name,
        });
      }
    }
    
    // Получаем список доступных моделей для обогащения данных
    const availableModels = await fetchOllamaModels();
    
    // Преобразуем установленные модели и добавляем статус
    const models = installedRaw.map(model => {
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
          gpu: status.gpu ?? 0,
          gpu_label: (idx.instances.find(i => i.id === (status.gpu ?? 0))?.name) || `GPU ${status.gpu ?? 0}`,
          description: availableModel?.description || 'No description available',
          capabilities: availableModel?.capabilities || [],
          downloadStatus: status
        });
      }
    }

    // Оборачиваем массив моделей в объект
    res.json({ models, instances: idx.instances });
  } catch (error) {
    logger.error('Error getting models:', error);
    res.status(500).json({ error: error.message });
  }
});

// Получение списка доступных для скачивания моделей
router.get('/available', async (req, res) => {
  try {
    // Получаем список установленных моделей (со всех Ollama инстансов)
    const idx = await refreshOllamaModelIndex({ force: true });
    const installedModelNames = new Set();
    for (const models of idx.modelsByInstance.values()) {
      for (const m of models) {
        if (m?.name) installedModelNames.add(m.name);
      }
    }
    
    // Получаем список моделей с ollama.com
    const availableModels = await fetchOllamaModels();
    
    // Фильтруем уже установленные модели
    const availableForDownload = availableModels.filter(m => !installedModelNames.has(m.name));
    
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

    const idx = await refreshOllamaModelIndex({ force: true });
    const installedModels = [];
    for (const inst of idx.instances) {
      const instModels = idx.modelsByInstance.get(inst.id) || [];
      for (const m of instModels) {
        installedModels.push({
          ...m,
          gpu: inst.id,
          gpu_label: inst.name,
        });
      }
    }

    res.json({
      models: {
        installed: installedModels,
        available: {
          ollama: ollamaModels,
          openrouter: openRouterModels
        }
      },
      instances: idx.instances
    });
  } catch (error) {
    logger.error('Error fetching models:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /models/pull:
 *   post:
 *     tags: [Models]
 *     summary: Pull a model from Ollama
 *     description: Start downloading a model from Ollama
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: The name of the model to pull
 *               size:
 *                 type: string
 *                 description: The size variant of the model
 *     responses:
 *       200:
 *         description: Success response with stream of download progress
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/pull', async (req, res) => {
  const { name, size, gpu } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Model name is required' });
  }
  
  try {
    const gpuId = Number.isFinite(Number(gpu)) ? Number(gpu) : 0;
    const instances = await getOllamaInstances();

    if (gpuId !== 0 && !instances.some(i => i.id === gpuId)) {
      return res.status(400).json({ error: `Requested GPU ${gpuId} is not available` });
    }

    const targetInstance = instances.find(i => i.id === gpuId) || instances[0];

    if (!targetInstance) {
      return res.status(400).json({ error: 'No Ollama instances available' });
    }

    // Формируем полное имя модели с учетом размера
    const modelName = size ? `${name}:${size}` : name;

    // Не даём скачать ту же модель на другой GPU (и вообще повторно)
    const idx = await refreshOllamaModelIndex({ force: true });
    if (idx.modelToInstance.has(modelName)) {
      const existing = idx.modelToInstance.get(modelName);
      return res.status(409).json({
        error: `Model ${modelName} is already installed on ${existing?.name || `GPU ${existing?.id ?? 0}`}`
      });
    }
    
    // Устанавливаем начальный статус скачивания
    modelDownloadStatus.set(modelName, {
      status: 'starting',
      progress: 0,
      message: 'Starting download',
      gpu: targetInstance.id
    });
    
    // Отправляем начальное уведомление через WebSocket
    logger.info(`Broadcasting initial download status for model ${modelName}`);
    broadcastModelUpdate({
      name: modelName,
      gpu: targetInstance.id,
      downloadStatus: {
        status: 'starting',
        progress: 0,
        message: 'Starting download'
      }
    });
    
    // Запускаем скачивание
    const pullUrl = `${targetInstance.baseUrl}/api/pull`;
    logger.info(`Pulling model ${modelName} from Ollama (${targetInstance.name})`);
    
    const ollamaResponse = await fetch(pullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: modelName, stream: true })
    });

    if (!ollamaResponse.ok) {
      throw new Error(`Failed to pull model: ${ollamaResponse.statusText}`);
    }

    // Настраиваем заголовки для серверных событий
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      // Инициализируем слежение за прогрессом
      let lastProgressBroadcast = 0;
      const BROADCAST_INTERVAL = 1000; // минимальный интервал между отправками через WebSocket в мс
      
      // Используем обработчик потока данных на основе pipe() и TextDecoder
      const decoder = new TextDecoder();
      let buffer = '';
      
      ollamaResponse.body.on('data', (chunk) => {
        buffer += decoder.decode(chunk, { stream: true });
        
        // Разбиваем буфер на строки и обрабатываем полные строки
        const lines = buffer.split('\n');
        
        // Оставляем последнюю (возможно неполную) строку в буфере
        buffer = lines.pop();
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const data = JSON.parse(line);
            const now = Date.now();
            
            // Обновляем статус модели
            if (data.completed && data.total) {
              const progress = Math.round((data.completed / data.total) * 100);
              modelDownloadStatus.set(modelName, {
                status: 'downloading',
                progress,
                message: `Downloading: ${progress}%`,
                gpu: targetInstance.id
              });
              
              // Отправляем данные клиенту через SSE
              res.write(`data: ${line}\n\n`);
              
              // Оповещаем через WebSocket не чаще чем раз в секунду
              if (now - lastProgressBroadcast > BROADCAST_INTERVAL) {
                lastProgressBroadcast = now;
                logger.info(`Broadcasting progress update for ${modelName}: ${progress}%`);
                broadcastModelUpdate({
                  name: modelName,
                  gpu: targetInstance.id,
                  downloadStatus: {
                    status: 'downloading',
                    progress,
                    message: `Downloading: ${progress}%`
                  }
                });
              }
            }
            
            if (data.status === 'success') {
              modelDownloadStatus.set(modelName, {
                status: 'ready',
                progress: 100,
                message: 'Model is ready',
                gpu: targetInstance.id
              });
              
              // Оповещаем через WebSocket
              logger.info(`Broadcasting completion for model ${modelName}`);
              broadcastModelUpdate({
                name: modelName,
                gpu: targetInstance.id,
                downloadStatus: {
                  status: 'ready',
                  progress: 100,
                  message: 'Model is ready'
                }
              });
            }
          } catch (e) {
            // Игнорируем ошибки парсинга JSON
            logger.error('Error parsing response line:', e);
          }
        }
      });
      
      // Обработка завершения потока
      ollamaResponse.body.on('end', () => {
        // Обрабатываем данные, которые могли остаться в буфере
        if (buffer.trim()) {
          try {
            const data = JSON.parse(buffer);
            if (data.status === 'success') {
              modelDownloadStatus.set(modelName, {
                status: 'ready',
                progress: 100,
                message: 'Model is ready'
              });
              
              broadcastModelUpdate({
                name: modelName,
                status: 'ready',
                progress: 100
              });
            }
          } catch (e) {
            // Игнорируем ошибки парсинга
          }
        }
        
        res.write('data: {"status": "done"}\n\n');
        res.end();
      });
      
      // Обработка ошибок чтения потока
      ollamaResponse.body.on('error', (err) => {
        logger.error('Error reading stream:', err);
        
        modelDownloadStatus.set(modelName, {
          status: 'error',
          progress: 0,
          message: err.message
        });
        
        broadcastModelUpdate({
          name: modelName,
          status: 'error',
          progress: 0
        });
        
        res.write(`data: {"error": "${err.message}"}\n\n`);
        res.end();
      });
      
    } catch (streamError) {
      logger.error('Error reading stream:', streamError);
      // Даже при ошибке чтения потока отправляем сообщение об ошибке, но продолжаем
      // мониторить состояние модели через существующий механизм
      startModelMonitoring(modelName, targetInstance.baseUrl);
      
      if (!res.headersSent) {
        res.status(500).json({ error: `Stream error: ${streamError.message}` });
      } else {
        res.write(`data: {"error": "${streamError.message}"}\n\n`);
        res.end();
      }
    }

  } catch (error) {
    logger.error('Error pulling model:', error);
    
    // Обновляем статус на ошибку
    modelDownloadStatus.set(name, {
      status: 'error',
      progress: 0,
      message: error.message,
      gpu: Number.isFinite(Number(gpu)) ? Number(gpu) : 0
    });
    
    // Оповещаем через WebSocket
    logger.info(`Broadcasting error for model ${name}: ${error.message}`);
    broadcastModelUpdate({
      name,
      gpu: Number.isFinite(Number(gpu)) ? Number(gpu) : 0,
      downloadStatus: {
        status: 'error',
        progress: 0,
        message: error.message
      }
    });
    
    if (!res.headersSent) {
      res.status(500).json({ error: `Failed to pull model: ${error.message}` });
    } else {
      res.write(`data: {"error": "${error.message}"}\n\n`);
      res.end();
    }
  }
});

// Проверка статуса модели
router.get('/status/:name', async (req, res) => {
  const { name } = req.params;
  
  try {
    // Проверяем статус модели через show
    const inst = await resolveOllamaInstanceForModel(name);
    const response = await fetch(`${inst.baseUrl}/api/show`, {
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
    const inst = await resolveOllamaInstanceForModel(name);
    const response = await fetch(`${inst.baseUrl}/api/delete`, {
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



export default router;
