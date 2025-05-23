import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Ollamify External API',
      version: '1.0.0',
      description: `
# Внешний API для Ollamify

Это документация внешних API эндпоинтов Ollamify, которые работают с API ключами.

## Аутентификация

Все эндпоинты требуют API ключ в заголовке Authorization:

\`\`\`
Authorization: Bearer YOUR_API_KEY
\`\`\`

## Получение API ключа

1. Войдите в админ панель Ollamify
2. Перейдите в раздел "Пользователи"
3. Создайте новый API ключ для нужного пользователя

## Поддерживаемые сервисы

- **AI & RAG** - Генерация ответов и поиск по документам
- **Documents** - Управление документами для RAG
- **TTS** - Синтез речи (Text-to-Speech)
- **STT** - Распознавание речи (Speech-to-Text)
- **OpenAI Compatible** - Совместимость с OpenAI Chat API

## Лимиты

- Максимальный размер файла: 50MB
- Таймаут запроса: 10 минут
- Поддерживаемые форматы аудио: WAV, MP3, FLAC, M4A, MP4

## Примеры использования

Подробные примеры кода на различных языках программирования доступны на вкладке "Примеры кода" в веб-интерфейсе.
      `
    },
    servers: [
      {
        url: '/',
        description: 'Олламify API сервер'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Введите ваш API ключ в формате: Bearer YOUR_API_KEY'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Сообщение об ошибке',
              example: 'Invalid API key'
            },
            code: {
              type: 'string',
              description: 'Код ошибки',
              example: 'INVALID_CREDENTIALS'
            },
            details: {
              type: 'string',
              description: 'Дополнительная информация об ошибке'
            }
          }
        },
        Document: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'ID документа',
              example: 1
            },
            name: {
              type: 'string',
              description: 'Название документа',
              example: 'my-document.pdf'
            },
            content_hash: {
              type: 'string',
              description: 'SHA-256 хеш содержимого документа'
            },
            total_chunks: {
              type: 'integer',
              description: 'Общее количество чанков',
              example: 50
            },
            loaded_chunks: {
              type: 'integer',
              description: 'Количество обработанных чанков',
              example: 50
            },
            metadata: {
              type: 'object',
              description: 'Метаданные документа',
              example: {
                fileSize: '1024000',
                mimeType: 'application/pdf'
              }
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Время создания'
            },
            external_id: {
              type: 'string',
              description: 'Внешний ID документа'
            },
            project: {
              type: 'string',
              description: 'Название проекта',
              example: 'my-documents'
            }
          }
        },
        DocumentList: {
          type: 'object',
          properties: {
            documents: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/Document'
              }
            },
            total: {
              type: 'integer',
              description: 'Общее количество документов',
              example: 100
            },
            page: {
              type: 'integer',
              description: 'Текущая страница',
              example: 1
            },
            limit: {
              type: 'integer',
              description: 'Количество элементов на странице',
              example: 10
            },
            total_pages: {
              type: 'integer',
              description: 'Общее количество страниц',
              example: 10
            }
          }
        },
        ChatMessage: {
          type: 'object',
          required: ['role', 'content'],
          properties: {
            role: {
              type: 'string',
              enum: ['system', 'user', 'assistant'],
              description: 'Роль сообщения',
              example: 'user'
            },
            content: {
              type: 'string',
              description: 'Содержимое сообщения',
              example: 'Привет, как дела?'
            }
          }
        },
        ChatCompletion: {
          type: 'object',
          required: ['model', 'messages'],
          properties: {
            model: {
              type: 'string',
              description: 'Название модели',
              example: 'llama3.1:8b'
            },
            messages: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/ChatMessage'
              },
              minItems: 1
            },
            temperature: {
              type: 'number',
              minimum: 0,
              maximum: 2,
              description: 'Температура сэмплирования',
              example: 0.7
            },
            max_tokens: {
              type: 'integer',
              minimum: 1,
              description: 'Максимальное количество токенов для генерации',
              example: 1000
            },
            stream: {
              type: 'boolean',
              description: 'Потоковая передача ответа',
              example: false
            },
            top_p: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Top-p сэмплирование',
              example: 0.9
            },
            frequency_penalty: {
              type: 'number',
              minimum: -2,
              maximum: 2,
              description: 'Штраф за частоту',
              example: 0
            },
            presence_penalty: {
              type: 'number',
              minimum: -2,
              maximum: 2,
              description: 'Штраф за присутствие',
              example: 0
            }
          }
        },
        ChatCompletionResponse: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'ID запроса',
              example: 'chatcmpl-123'
            },
            object: {
              type: 'string',
              example: 'chat.completion'
            },
            created: {
              type: 'integer',
              description: 'Unix timestamp создания'
            },
            model: {
              type: 'string',
              example: 'llama3.1:8b'
            },
            choices: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: {
                    type: 'integer'
                  },
                  message: {
                    $ref: '#/components/schemas/ChatMessage'
                  },
                  finish_reason: {
                    type: 'string',
                    enum: ['stop', 'length']
                  }
                }
              }
            },
            usage: {
              type: 'object',
              properties: {
                prompt_tokens: {
                  type: 'integer'
                },
                completion_tokens: {
                  type: 'integer'
                },
                total_tokens: {
                  type: 'integer'
                }
              }
            }
          }
        },
        RagRequest: {
          type: 'object',
          required: ['question', 'project'],
          properties: {
            question: {
              type: 'string',
              description: 'Вопрос пользователя',
              example: 'Что такое машинное обучение?'
            },
            project: {
              type: 'string',
              description: 'Название проекта для поиска',
              example: 'my-documents'
            },
            model: {
              type: 'string',
              description: 'Модель для генерации ответа',
              example: 'llama3.1:8b'
            },
            temperature: {
              type: 'number',
              minimum: 0,
              maximum: 2,
              description: 'Температура генерации',
              example: 0.7
            },
            max_tokens: {
              type: 'integer',
              minimum: 1,
              description: 'Максимум токенов в ответе',
              example: 1000
            }
          }
        },
        RagResponse: {
          type: 'object',
          properties: {
            answer: {
              type: 'string',
              description: 'Сгенерированный ответ'
            },
            sources: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  document_name: {
                    type: 'string'
                  },
                  chunk_content: {
                    type: 'string'
                  },
                  score: {
                    type: 'number'
                  }
                }
              }
            }
          }
        },
        TTSRequest: {
          type: 'object',
          required: ['text'],
          properties: {
            text: {
              type: 'string',
              description: 'Текст для синтеза речи',
              example: 'Привет, как дела?'
            },
            voice: {
              type: 'string',
              description: 'Голос для синтеза',
              example: 'ru_speaker'
            },
            speed: {
              type: 'number',
              minimum: 0.1,
              maximum: 3.0,
              description: 'Скорость речи',
              example: 1.0
            }
          }
        },
        STTTranscription: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Распознанный текст',
              example: 'Привет, как дела?'
            },
            language: {
              type: 'string',
              description: 'Определенный язык',
              example: 'ru'
            },
            confidence: {
              type: 'number',
              description: 'Уверенность в результате',
              example: 0.95
            }
          }
        }
      }
    },
    security: [
      {
        ApiKeyAuth: []
      }
    ],
    tags: [
      {
        name: 'OpenAI Compatible',
        description: 'OpenAI совместимые эндпоинты для чат-завершений'
      },
      {
        name: 'AI & RAG',
        description: 'Генерация ответов и поиск по документам (RAG)'
      },
      {
        name: 'Documents',
        description: 'Управление документами для RAG системы'
      },
      {
        name: 'TTS',
        description: 'Синтез речи (Text-to-Speech)'
      },
      {
        name: 'STT',
        description: 'Распознавание речи (Speech-to-Text)'
      }
    ]
  },
  apis: [
    './src/routes/ai.js',
    './src/routes/documents.js',
    './src/routes/tts.js',
    './src/routes/stt.js'
  ]
};

const fullSpecs = swaggerJsdoc(options);

// Фильтруем внутренние эндпоинты
const filteredPaths = {};
Object.keys(fullSpecs.paths || {}).forEach(path => {
  const pathItem = fullSpecs.paths[path];
  const filteredPathItem = {};
  
  Object.keys(pathItem).forEach(method => {
    const operation = pathItem[method];
    // Исключаем эндпоинты с тегом "Internal"
    if (operation.tags && !operation.tags.includes('Internal')) {
      filteredPathItem[method] = operation;
    }
  });
  
  // Добавляем путь только если есть неотфильтрованные методы
  if (Object.keys(filteredPathItem).length > 0) {
    filteredPaths[path] = filteredPathItem;
  }
});

export const externalSpecs = {
  ...fullSpecs,
  paths: filteredPaths
}; 