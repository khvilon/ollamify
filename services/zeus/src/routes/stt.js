import express from 'express';
import fetch from 'node-fetch';
import multer from 'multer';
import FormData from 'form-data';
import logger from '../utils/logger.js';

const router = express.Router();

// URL STT сервиса
const STT_SERVICE_URL = process.env.STT_SERVICE_URL || 'http://stt:8004';

// Настройка multer для обработки файлов
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB
    }
});

/**
 * @swagger
 * components:
 *   schemas:
 *     STTModelsResponse:
 *       type: object
 *       properties:
 *         models:
 *           type: object
 *           additionalProperties:
 *             type: object
 *             properties:
 *               size:
 *                 type: string
 *               speed:
 *                 type: string
 *               quality:
 *                 type: string
 *         current_model:
 *           type: string
 *         languages:
 *           type: object
 *           additionalProperties:
 *             type: string
 *     STTTranscribeRequest:
 *       type: object
 *       properties:
 *         audio:
 *           type: string
 *           format: binary
 *           description: Аудио файл для распознавания
 *         language:
 *           type: string
 *           description: Код языка (ru, en, etc.)
 *         task:
 *           type: string
 *           enum: [transcribe, translate]
 *           description: Задача (transcribe или translate)
 *     STTTranscribeResponse:
 *       type: object
 *       properties:
 *         text:
 *           type: string
 *           description: Распознанный текст
 *         language:
 *           type: string
 *           description: Определенный язык
 *         task:
 *           type: string
 *           description: Выполненная задача
 *         model:
 *           type: string
 *           description: Использованная модель
 *         segments:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               start:
 *                 type: number
 *               end:
 *                 type: number
 *               text:
 *                 type: string
 */

/**
 * @swagger
 * /api/stt/models:
 *   get:
 *     summary: Получить список доступных STT моделей
 *     tags: [STT]
 *     responses:
 *       200:
 *         description: Список доступных моделей Whisper
 *       503:
 *         description: STT сервис недоступен
 */
router.get('/models', async (req, res) => {
    try {
        logger.info('Getting available STT models (Whisper)');

        const response = await fetch(`${STT_SERVICE_URL}/models`, {
            method: 'GET',
            timeout: 10000
        });

        if (!response.ok) {
            throw new Error(`STT service responded with status: ${response.status}`);
        }

        const data = await response.json();
        res.json(data);

    } catch (error) {
        logger.error('Error getting STT models:', error);
        res.status(503).json({
            error: 'STT сервис недоступен',
            details: error.message
        });
    }
});

/**
 * @swagger
 * /api/stt/transcribe:
 *   post:
 *     summary: Распознавание речи из аудио файла
 *     tags: [STT]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *               language:
 *                 type: string
 *               task:
 *                 type: string
 *     responses:
 *       200:
 *         description: Успешное распознавание речи
 *       400:
 *         description: Ошибка в параметрах запроса
 *       503:
 *         description: STT сервис недоступен
 */
router.post('/transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: 'Аудио файл не найден'
            });
        }

        const { language = 'auto', task = 'transcribe' } = req.body;

        logger.info(`STT Whisper transcription request for file: ${req.file.originalname}, size: ${req.file.size} bytes, language: ${language}, task: ${task}`);

        // Создаем FormData для отправки в STT сервис
        const formData = new FormData();
        
        formData.append('audio', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype
        });
        formData.append('language', language);
        formData.append('task', task);

        // Отправляем запрос в STT сервис
        const response = await fetch(`${STT_SERVICE_URL}/transcribe`, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders(),
            timeout: 300000 // 5 минут на транскрибацию
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `STT service error: ${response.status}`);
        }

        const result = await response.json();
        
        logger.info(`STT Whisper transcription completed: ${result.text.length} characters`);
        res.json(result);

    } catch (error) {
        logger.error('Error in STT Whisper transcription:', error);
        
        if (error.message.includes('timeout')) {
            res.status(408).json({
                error: 'Время ожидания истекло',
                details: 'Транскрибация заняла слишком много времени'
            });
        } else {
            res.status(503).json({
                error: 'Ошибка распознавания речи',
                details: error.message
            });
        }
    }
});

/**
 * @swagger
 * /api/stt/model/load:
 *   post:
 *     summary: Загрузка указанной модели Whisper
 *     tags: [STT]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               model_name:
 *                 type: string
 *                 description: Название модели (tiny, base, small, medium, large)
 *     responses:
 *       200:
 *         description: Модель успешно загружена
 *       400:
 *         description: Ошибка в параметрах
 *       503:
 *         description: STT сервис недоступен
 */
router.post('/model/load', async (req, res) => {
    try {
        const { model_name } = req.body;

        if (!model_name) {
            return res.status(400).json({
                error: 'Не указано название модели'
            });
        }

        logger.info(`Loading STT model: ${model_name}`);

        const response = await fetch(`${STT_SERVICE_URL}/model/load`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ model_name }),
            timeout: 120000 // 2 минуты на загрузку модели
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `STT service error: ${response.status}`);
        }

        const result = await response.json();
        
        logger.info(`STT model ${model_name} loaded successfully`);
        res.json(result);

    } catch (error) {
        logger.error('Error loading STT model:', error);
        
        if (error.message.includes('timeout')) {
            res.status(408).json({
                error: 'Время ожидания истекло',
                details: 'Загрузка модели заняла слишком много времени'
            });
        } else {
            res.status(503).json({
                error: 'Ошибка загрузки модели',
                details: error.message
            });
        }
    }
});

/**
 * @swagger
 * /api/stt/health:
 *   get:
 *     summary: Проверка состояния STT сервиса
 *     tags: [STT]
 *     responses:
 *       200:
 *         description: Состояние STT сервиса
 *       503:
 *         description: STT сервис недоступен
 */
router.get('/health', async (req, res) => {
    try {
        const response = await fetch(`${STT_SERVICE_URL}/health`, {
            method: 'GET',
            timeout: 5000
        });

        if (!response.ok) {
            throw new Error(`STT service health check failed: ${response.status}`);
        }

        const healthData = await response.json();
        res.json(healthData);

    } catch (error) {
        logger.error('STT health check failed:', error);
        res.status(503).json({
            error: 'STT сервис недоступен',
            details: error.message
        });
    }
});

export default router; 