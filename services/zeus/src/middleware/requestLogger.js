import pool from '../db/conf.js';
import logger from '../utils/logger.js';

// Функция для проверки нужно ли логировать запрос
function shouldLogRequest(method, path) {
    // Исключаем GET запросы
    if (method === 'GET') {
        return false;
    }
    
    // Логируем только AI-related запросы
    const aiPaths = [
        '/ai/',           // RAG, completion
        '/tts/',          // Text-to-Speech
        '/stt/',          // Speech-to-Text
        '/embedding/'     // Embedding requests
    ];
    
    return aiPaths.some(aiPath => path.includes(aiPath));
}

// Функция для извлечения текста пользователя из запроса
function extractUserText(body, path) {
    try {
        if (!body || typeof body !== 'object') return null;
        
        // AI чат - последнее сообщение пользователя
        if (path.includes('/ai/chat') && body.messages && Array.isArray(body.messages)) {
            // Ищем последнее сообщение от пользователя
            for (let i = body.messages.length - 1; i >= 0; i--) {
                const msg = body.messages[i];
                if (msg.role === 'user' && msg.content) {
                    return msg.content.substring(0, 1000); // Ограничиваем длину
                }
            }
        }
        
        // TTS - текст для синтеза
        if (path.includes('/tts/') && body.text) {
            return body.text.substring(0, 1000);
        }
        
        // STT - обычно файл, но может быть текст
        if (path.includes('/stt/') && body.text) {
            return body.text.substring(0, 1000);
        }
        
        // Embedding - текст для векторизации
        if (path.includes('/embedding/') && body.text) {
            return body.text.substring(0, 1000);
        }
        
        // Общие поля
        if (body.query) {
            return body.query.substring(0, 1000);
        }
        
        if (body.prompt) {
            return body.prompt.substring(0, 1000);
        }
        
        return null;
    } catch (error) {
        return null;
    }
}

// Функция для извлечения информации о модели из тела запроса
function extractModelInfo(body, path) {
    try {
        if (!body || typeof body !== 'object') return null;
        
        // Различные поля где может быть модель
        const modelFields = ['model', 'model_name', 'embedding_model', 'modelName'];
        
        for (const field of modelFields) {
            if (body[field]) {
                return body[field];
            }
        }
        
        // Специальные случаи по путям
        if (path.includes('/ai/chat') && body.messages) {
            return body.model || 'default_chat_model';
        }
        
        return null;
    } catch (error) {
        return null;
    }
}

// Функция для создания краткого описания запроса
function createRequestSummary(body, path, method) {
    try {
        if (!body || typeof body !== 'object') {
            return `${method} ${path}`;
        }
        
        const summary = [];
        
        // Добавляем информацию в зависимости от endpoint
        if (path.includes('/ai/chat')) {
            const messageCount = body.messages ? body.messages.length : 0;
            const lastMessage = body.messages && body.messages.length > 0 ? 
                body.messages[body.messages.length - 1].content?.substring(0, 50) + '...' : '';
            summary.push(`Chat: ${messageCount} messages`);
            if (lastMessage) summary.push(`"${lastMessage}"`);
        } else if (path.includes('/tts/synthesize')) {
            const text = body.text ? body.text.substring(0, 50) + '...' : '';
            const voice = body.voice || 'default';
            summary.push(`TTS: voice=${voice}`);
            if (text) summary.push(`"${text}"`);
        } else if (path.includes('/stt/transcribe')) {
            const language = body.language || 'auto';
            summary.push(`STT: lang=${language}`);
        } else if (path.includes('/embedding')) {
            const textLength = body.text ? body.text.length : 0;
            summary.push(`Embedding: ${textLength} chars`);
        }
        
        return summary.length > 0 ? summary.join(', ') : `${method} ${path}`;
        
    } catch (error) {
        return `${method} ${path}`;
    }
}

// Функция для определения категории endpoint
function getEndpointCategory(path) {
    if (path.includes('/ai/')) return 'AI';
    if (path.includes('/tts/')) return 'TTS';
    if (path.includes('/stt/')) return 'STT';
    if (path.includes('/models/')) return 'Models';
    if (path.includes('/projects/')) return 'Projects';
    if (path.includes('/users/')) return 'Users';
    if (path.includes('/admin/')) return 'Admin';
    if (path.includes('/health')) return 'Health';
    return 'Other';
}

export const requestLogger = async (req, res, next) => {
    // Проверяем нужно ли логировать этот запрос
    if (!shouldLogRequest(req.method, req.path)) {
        return next();
    }

    const startTime = Date.now();
    let client;

    try {
        client = await pool.connect();

        // Store original response methods
        const originalJson = res.json;
        const originalSend = res.send;
        let responseBody = null;

        // Intercept response.json()
        res.json = function(body) {
            responseBody = body;
            return originalJson.call(this, body);
        };

        // Intercept response.send()
        res.send = function(body) {
            responseBody = body;
            return originalSend.call(this, body);
        };

        // Once the response is finished
        res.on('finish', async () => {
            const endTime = Date.now();
            const responseTime = endTime - startTime;

            try {
                // Extract user information from headers
                const userHeader = req.headers['x-user'];
                let userName = null;
                let userKey = null;
                let apiKeyName = null;
                
                if (userHeader) {
                    try {
                        const userData = JSON.parse(userHeader);
                        userName = userData.username;
                        
                        if (userName) {
                            // Get user's API key from database
                            const apiKeyResult = await client.query(
                                `SELECT ak.name as key_name, ak.key_value
                                 FROM admin.api_keys ak
                                 JOIN admin.users u ON u.id = ak.user_id
                                 WHERE u.username = $1
                                 ORDER BY ak.created_at DESC
                                 LIMIT 1`,
                                [userName]
                            );
                            
                            if (apiKeyResult.rows.length > 0) {
                                userKey = apiKeyResult.rows[0].key_value;
                                apiKeyName = apiKeyResult.rows[0].key_name;
                            }
                        }
                    } catch (error) {
                        logger.error('Failed to process user information:', error);
                    }
                }

                var ip
                try {
                    ip = req.ip || req.headers["x-forwarded-for"] || req.headers["x-real-ip"]
                } catch {
                    ip = ""
                }

                // Извлекаем дополнительную информацию
                const modelName = extractModelInfo(req.body, req.path);
                const requestSummary = createRequestSummary(req.body, req.path, req.method);
                const endpointCategory = getEndpointCategory(req.path);
                const userText = extractUserText(req.body, req.path);

                const logEntry = {
                    user_name: userName,
                    user_key: userKey,
                    api_key_name: apiKeyName,
                    request_method: req.method,
                    request_path: req.path,
                    request_body: JSON.stringify(req.body),
                    ip_address: JSON.stringify(ip),
                    response_body: JSON.stringify(responseBody),
                    response_time: responseTime,
                    model_name: modelName,
                    request_summary: requestSummary,
                    endpoint_category: endpointCategory,
                    user_text: userText
                };

                await client.query(
                    `INSERT INTO admin.user_logs 
                    (user_name, user_key, api_key_name, request_method, request_path, request_body, ip_address, 
                     response_body, response_time, model_name, request_summary, endpoint_category, user_text)
                    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11, $12, $13)`,
                    [
                        logEntry.user_name,
                        logEntry.user_key,
                        logEntry.api_key_name,
                        logEntry.request_method,
                        logEntry.request_path,
                        logEntry.request_body,
                        logEntry.ip_address,
                        logEntry.response_body,
                        logEntry.response_time,
                        logEntry.model_name,
                        logEntry.request_summary,
                        logEntry.endpoint_category,
                        logEntry.user_text
                    ]
                );

                logger.info(`Logged request-response cycle for ${req.path} (${responseTime}ms)`);
            } catch (error) {
                logger.error('Error logging response:', error);
            } finally {
                client.release();
            }
        });

        next();
    } catch (error) {
        logger.error('Error setting up response logging:', error);
        if (client) client.release();
        next();
    }
};
