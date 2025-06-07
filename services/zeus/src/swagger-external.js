import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Ollamify External API',
      version: '1.0.0',
      description: `
# Ollamify External API

This is the documentation for Ollamify's external API endpoints that work with API keys.

## Authentication

All endpoints require an API key in the Authorization header:

\`\`\`
Authorization: Bearer YOUR_API_KEY
\`\`\`

## Getting API Key

1. Log in to Ollamify admin panel
2. Go to "Users" section
3. Create a new API key for the required user

## Supported Services

- **AI & RAG** - Answer generation and document search
- **Documents** - Document management for RAG
- **TTS** - Text-to-Speech synthesis
- **STT** - Speech-to-Text recognition
- **OpenAI Compatible** - OpenAI Chat API compatibility

## Limits

- Maximum file size: 50MB
- Request timeout: 10 minutes
- Supported audio formats: WAV, MP3, FLAC, M4A, MP4

## Usage Examples

Detailed code examples in various programming languages are available on the "Code Examples" tab in the web interface.
      `
    },
    servers: [
      {
        url: '/',
        description: 'Ollamify API Server'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Enter your API key in the format: Bearer YOUR_API_KEY'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message',
              example: 'Invalid API key'
            },
            code: {
              type: 'string',
              description: 'Error code',
              example: 'INVALID_CREDENTIALS'
            },
            details: {
              type: 'string',
              description: 'Additional information about the error'
            }
          }
        },
        Document: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Document ID',
              example: 1
            },
            name: {
              type: 'string',
              description: 'Document name',
              example: 'my-document.pdf'
            },
            content_hash: {
              type: 'string',
              description: 'SHA-256 hash of document content'
            },
            total_chunks: {
              type: 'integer',
              description: 'Total number of chunks',
              example: 50
            },
            loaded_chunks: {
              type: 'integer',
              description: 'Number of processed chunks',
              example: 50
            },
            metadata: {
              type: 'object',
              description: 'Document metadata',
              example: {
                fileSize: '1024000',
                mimeType: 'application/pdf'
              }
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Creation time'
            },
            external_id: {
              type: 'string',
              description: 'External document ID'
            },
            project: {
              type: 'string',
              description: 'Project name',
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
              description: 'Total number of documents',
              example: 100
            },
            page: {
              type: 'integer',
              description: 'Current page',
              example: 1
            },
            limit: {
              type: 'integer',
              description: 'Number of items per page',
              example: 10
            },
            total_pages: {
              type: 'integer',
              description: 'Total number of pages',
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
              description: 'Message role',
              example: 'user'
            },
            content: {
              type: 'string',
              description: 'Message content',
              example: 'Hello, how are you?'
            }
          }
        },
        ChatCompletion: {
          type: 'object',
          required: ['model', 'messages'],
          properties: {
            model: {
              type: 'string',
              description: 'Model name',
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
              description: 'Sampling temperature',
              example: 0.7
            },
            max_tokens: {
              type: 'integer',
              minimum: 1,
              description: 'Maximum number of tokens to generate',
              example: 1000
            },
            stream: {
              type: 'boolean',
              description: 'Stream response',
              example: false
            },
            top_p: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Top-p sampling',
              example: 0.9
            },
            frequency_penalty: {
              type: 'number',
              minimum: -2,
              maximum: 2,
              description: 'Frequency penalty',
              example: 0
            },
            presence_penalty: {
              type: 'number',
              minimum: -2,
              maximum: 2,
              description: 'Presence penalty',
              example: 0
            }
          }
        },
        ChatCompletionResponse: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Request ID',
              example: 'chatcmpl-123'
            },
            object: {
              type: 'string',
              example: 'chat.completion'
            },
            created: {
              type: 'integer',
              description: 'Unix timestamp of creation'
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
              description: 'User question',
              example: 'What is machine learning?'
            },
            project: {
              type: 'string',
              description: 'Project name for search',
              example: 'my-documents'
            },
            model: {
              type: 'string',
              description: 'Model for answer generation',
              example: 'llama3.1:8b'
            },
            temperature: {
              type: 'number',
              minimum: 0,
              maximum: 2,
              description: 'Generation temperature',
              example: 0.7
            },
            max_tokens: {
              type: 'integer',
              minimum: 1,
              description: 'Maximum tokens in response',
              example: 1000
            }
          }
        },
        RagResponse: {
          type: 'object',
          properties: {
            answer: {
              type: 'string',
              description: 'Generated answer'
            },
            thinking: {
              type: 'string',
              description: 'LLM reasoning process (if available)',
              nullable: true
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
              description: 'Text for speech synthesis',
              example: 'Hello, how are you?'
            },
            voice: {
              type: 'string',
              description: 'Voice for synthesis',
              example: 'ru_speaker'
            },
            speed: {
              type: 'number',
              minimum: 0.1,
              maximum: 3.0,
              description: 'Speech speed',
              example: 1.0
            }
          }
        },
        STTTranscription: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Recognized text',
              example: 'Hello, how are you?'
            },
            language: {
              type: 'string',
              description: 'Detected language',
              example: 'en'
            },
            confidence: {
              type: 'number',
              description: 'Result confidence',
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
        description: 'OpenAI compatible endpoints for chat completions'
      },
      {
        name: 'AI & RAG',
        description: 'Answer generation and document search (RAG)'
      },
      {
        name: 'Documents',
        description: 'Document management for RAG system'
      },
      {
        name: 'TTS',
        description: 'Text-to-Speech synthesis'
      },
      {
        name: 'STT',
        description: 'Speech-to-Text recognition'
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