import express from 'express';
import fetch from 'node-fetch';
import logger from '../utils/logger.js';

const router = express.Router();

// URL TTS сервиса
const TTS_SERVICE_URL = process.env.TTS_SERVICE_URL || 'http://tts:8003';

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
 *           enum: [female_1, female_2, male_1, male_2]
 *           default: female_1
 *           description: Голос для озвучивания
 *         speed:
 *           type: number
 *           minimum: 0.5
 *           maximum: 2.0
 *           default: 1.0
 *           description: Скорость речи
 *         sample_rate:
 *           type: integer
 *           enum: [22050, 24000]
 *           default: 24000
 *           description: Частота дискретизации
 *         format:
 *           type: string
 *           enum: [wav]
 *           default: wav
 *           description: Формат аудио
 *         language:
 *           type: string
 *           enum: [ru, en, es, fr, de, it, pt, pl, tr, nl, cs, ar, zh, ja, hu, ko]
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
 * /api/tts/voices:
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
    logger.info('Getting available TTS voices (XTTS v2)');
    
    const response = await fetch(`${TTS_SERVICE_URL}/voices`, {
      method: 'GET',
      timeout: 5000
    });
    
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
 * /api/tts/synthesize:
 *   post:
 *     summary: Синтез речи из текста (Coqui XTTS v2)
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
    const { text, voice = 'female_1', speed = 1.0, sample_rate = 24000, format = 'wav', language = 'ru' } = req.body;
    
    // Валидация входных данных
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Текст обязателен для заполнения' });
    }
    
    if (text.length > 1000) {
      return res.status(400).json({ error: 'Текст слишком длинный (максимум 1000 символов)' });
    }
    
    logger.info(`TTS XTTS synthesis request: "${text.substring(0, 50)}..." with voice: ${voice}, language: ${language}`);
    
    // Отправляем запрос в TTS сервис
    const response = await fetch(`${TTS_SERVICE_URL}/synthesize`, {
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
      }),
      timeout: 60000 // 60 секунд на синтез для XTTS
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `TTS service error: ${response.status}`);
    }
    
    const result = await response.json();
    
    logger.info(`TTS XTTS synthesis completed, duration: ${result.duration_ms}ms`);
    res.json(result);
    
  } catch (error) {
    logger.error('Error in TTS XTTS synthesis:', error);
    
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
 * /api/tts/synthesize/stream:
 *   post:
 *     summary: Синтез речи с возвратом аудио потока (XTTS v2)
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
    const { text, voice = 'female_1', speed = 1.0, sample_rate = 24000, format = 'wav', language = 'ru' } = req.body;
    
    // Валидация входных данных
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Текст обязателен для заполнения' });
    }
    
    logger.info(`TTS XTTS stream synthesis request: "${text.substring(0, 50)}..." with voice: ${voice}, language: ${language}`);
    
    // Отправляем запрос в TTS сервис
    const response = await fetch(`${TTS_SERVICE_URL}/synthesize/stream`, {
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
      }),
      timeout: 60000
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`TTS service error: ${response.status} - ${errorData}`);
    }
    
    // Передаем аудио поток клиенту
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', 'attachment; filename=speech.wav');
    
    // Передаем поток данных
    response.body.pipe(res);
    
  } catch (error) {
    logger.error('Error in TTS XTTS stream synthesis:', error);
    res.status(503).json({ 
      error: 'Ошибка потокового синтеза речи',
      details: error.message 
    });
  }
});

/**
 * @swagger
 * /api/tts/health:
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
    const response = await fetch(`${TTS_SERVICE_URL}/health`, {
      method: 'GET',
      timeout: 5000
    });
    
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