import express from 'express';
import logger from '../utils/logger.js';
import { fetchWithTimeout } from '../utils/ollama.js';

const router = express.Router();

// URL TTS сервиса
const TTS_SERVICE_URL = process.env.TTS_SERVICE_URL || 'http://tts-realtime:8006';
const DEFAULT_TTS_SYNTHESIS_TIMEOUT_MS = 300000;
export const DEFAULT_TTS_SPEED = 0.65;

export function normalizeTtsSynthesisTimeoutMs(value = process.env.TTS_SYNTHESIS_TIMEOUT_MS) {
  const timeoutMs = Number(value);
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_TTS_SYNTHESIS_TIMEOUT_MS;
}

const TTS_SYNTHESIS_TIMEOUT_MS = normalizeTtsSynthesisTimeoutMs();

/**
 * @swagger
 * components:
 *   schemas:
 *     TTSRequest:
 *       type: object
 *       required:
 *         - text
 *       properties:
 *         text:
 *           type: string
 *           description: Текст для озвучивания
 *           maxLength: 1000
 *         voice:
 *           type: string
 *           default: ""
 *           description: Голос TTS провайдера (опционально, по умолчанию выбирается автоматически по языку)
 *         speed:
 *           type: number
 *           minimum: 0.5
 *           maximum: 2.0
 *           default: 0.65
 *           description: Скорость речи
 *         sample_rate:
 *           type: integer
 *           enum: [8000, 24000, 48000]
 *           default: 24000
 *           description: Частота дискретизации
 *         format:
 *           type: string
 *           enum: [wav, mp3]
 *           default: mp3
 *           description: Формат аудио
 *         language:
 *           type: string
 *           enum: [ru, en, he]
 *           default: ru
 *           description: Язык синтеза
 *     
 *     TTSResponse:
 *       type: object
 *       properties:
 *         audio_base64:
 *           type: string
 *           description: Аудио файл в формате base64
 *         format:
 *           type: string
 *           description: Формат аудио файла
 *         sample_rate:
 *           type: integer
 *           description: Частота дискретизации
 *         duration_ms:
 *           type: integer
 *           description: Длительность в миллисекундах
 *     
 *     VoiceInfo:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           description: Название голоса
 *         gender:
 *           type: string
 *           description: Пол голоса
 *         language:
 *           type: string
 *           description: Язык голоса
 *         description:
 *           type: string
 *           description: Описание голоса
 */

/**
 * @swagger
 * /tts/voices:
 *   get:
 *     summary: Получить список доступных голосов
 *     tags: [TTS]
 *     responses:
 *       200:
 *         description: Список голосов
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/VoiceInfo'
 *       503:
 *         description: TTS сервис недоступен
 */
router.get('/voices', async (req, res) => {
  try {
    logger.info('Getting available TTS voices (Realtime TTS)');
    
    const response = await fetchWithTimeout(`${TTS_SERVICE_URL}/voices`, {
      method: 'GET'
    }, 5000);
    
    if (!response.ok) {
      throw new Error(`TTS service responded with status: ${response.status}`);
    }
    
    const voices = await response.json();
    res.json(voices);
    
  } catch (error) {
    logger.error('Error getting TTS voices:', error);
    res.status(503).json({ 
      error: 'TTS сервис недоступен',
      details: error.message 
    });
  }
});

/**
 * @swagger
 * /tts/synthesize:
 *   post:
 *     summary: Синтез речи из текста (Realtime TTS)
 *     tags: [TTS]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TTSRequest'
 *     responses:
 *       200:
 *         description: Успешный синтез речи
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TTSResponse'
 *       400:
 *         description: Неверный запрос
 *       503:
 *         description: TTS сервис недоступен
 */
router.post('/synthesize', async (req, res) => {
  try {
    const { text, voice = '', speed = DEFAULT_TTS_SPEED, sample_rate = 24000, format = 'mp3', language = 'ru' } = req.body;
    
    // Валидация входных данных
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Текст обязателен для заполнения' });
    }
    
    if (text.length > 1000) {
      return res.status(400).json({ error: 'Текст слишком длинный (максимум 1000 символов)' });
    }
    
    logger.info(`TTS synthesis request: "${text.substring(0, 50)}..." with voice: ${voice}, language: ${language}`);
    
    // Отправляем запрос в TTS сервис
    const response = await fetchWithTimeout(`${TTS_SERVICE_URL}/synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        voice,
        speed,
        sample_rate,
        format,
        language
      })
    }, TTS_SYNTHESIS_TIMEOUT_MS);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `TTS service error: ${response.status}`);
    }
    
    const result = await response.json();
    
    logger.info(`TTS synthesis completed, duration: ${result.duration_ms}ms`);
    res.json(result);
    
  } catch (error) {
    logger.error('Error in TTS synthesis:', error);
    
    if (error.message.includes('timeout')) {
      res.status(504).json({ error: 'Тайм-аут синтеза речи' });
    } else {
      res.status(503).json({ 
        error: 'Ошибка синтеза речи',
        details: error.message 
      });
    }
  }
});

/**
 * @swagger
 * /tts/synthesize/stream:
 *   post:
 *     summary: Синтез речи с возвратом аудио потока (Realtime TTS)
 *     tags: [TTS]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TTSRequest'
 *     responses:
 *       200:
 *         description: Аудио файл
 *         content:
 *           audio/wav:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Неверный запрос
 *       503:
 *         description: TTS сервис недоступен
 */
router.post('/synthesize/stream', async (req, res) => {
  try {
    const { text, voice = '', speed = DEFAULT_TTS_SPEED, sample_rate = 24000, format = 'mp3', language = 'ru' } = req.body;
    
    // Валидация входных данных
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Текст обязателен для заполнения' });
    }
    
    logger.info(`TTS stream synthesis request: "${text.substring(0, 50)}..." with voice: ${voice}, language: ${language}`);
    
    // Отправляем запрос в TTS сервис
    const response = await fetchWithTimeout(`${TTS_SERVICE_URL}/synthesize/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        voice,
        speed,
        sample_rate,
        format,
        language
      })
    }, TTS_SYNTHESIS_TIMEOUT_MS);
    
    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`TTS service error: ${response.status} - ${errorData}`);
    }
    
    // Передаем аудио поток клиенту
    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const extension = contentType.includes('wav') ? 'wav' : 'mp3';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename=speech.${extension}`);
    
    // Передаем поток данных
    response.body.pipe(res);
    
  } catch (error) {
    logger.error('Error in TTS stream synthesis:', error);
    res.status(503).json({ 
      error: 'Ошибка потокового синтеза речи',
      details: error.message 
    });
  }
});

router.post('/synthesize/pcm-stream', async (req, res) => {
  try {
    const { text, voice = '', speed = DEFAULT_TTS_SPEED, sample_rate = 24000, format = 'pcm', language = 'ru' } = req.body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'РўРµРєСЃС‚ РѕР±СЏР·Р°С‚РµР»РµРЅ РґР»СЏ Р·Р°РїРѕР»РЅРµРЅРёСЏ' });
    }

    logger.info(`TTS PCM stream request: "${text.substring(0, 50)}..." with voice: ${voice}, language: ${language}`);

    const response = await fetchWithTimeout(`${TTS_SERVICE_URL}/synthesize/pcm-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        voice,
        speed,
        sample_rate,
        format,
        language
      })
    }, TTS_SYNTHESIS_TIMEOUT_MS);

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`TTS service error: ${response.status} - ${errorData}`);
    }

    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename=speech.pcm');
    for (const headerName of ['x-audio-codec', 'x-audio-sample-rate', 'x-audio-channels']) {
      const headerValue = response.headers.get(headerName);
      if (headerValue) {
        res.setHeader(headerName, headerValue);
      }
    }

    response.body.pipe(res);
  } catch (error) {
    logger.error('Error in TTS PCM stream synthesis:', error);
    res.status(503).json({
      error: 'РћС€РёР±РєР° PCM-СЃС‚СЂРёРјРёРЅРіР° СЃРёРЅС‚РµР·Р° СЂРµС‡Рё',
      details: error.message
    });
  }
});

/**
 * @swagger
 * /tts/health:
 *   get:
 *     summary: Проверка состояния TTS сервиса
 *     tags: [TTS]
 *     responses:
 *       200:
 *         description: Состояние TTS сервиса
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 model_loaded:
 *                   type: boolean
 *                 model_loading:
 *                   type: boolean
 *                 device:
 *                   type: string
 *                 model_type:
 *                   type: string
 *                 license:
 *                   type: string
 */
router.get('/health', async (req, res) => {
  try {
    const response = await fetchWithTimeout(`${TTS_SERVICE_URL}/health`, {
      method: 'GET'
    }, 5000);
    
    if (!response.ok) {
      throw new Error(`TTS service health check failed: ${response.status}`);
    }
    
    const health = await response.json();
    res.json(health);
    
  } catch (error) {
    logger.error('TTS health check failed:', error);
    res.status(503).json({ 
      status: 'unhealthy',
      error: error.message 
    });
  }
});

export default router;
