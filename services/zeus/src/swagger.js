import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Ollamify API Documentation',
      version: '1.0.0',
      description: 'API documentation for external Ollamify services',
      contact: {
        name: 'API Support'
      }
    },
    servers: [
      {
        url: '/api',
        description: 'API server'
      }
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description: 'API key with Bearer prefix. Example: Bearer YOUR_API_KEY'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message'
            },
            code: {
              type: 'string',
              description: 'Error code'
            },
            details: {
              type: 'string',
              description: 'Detailed error information'
            }
          }
        },
        Document: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Document ID'
            },
            name: {
              type: 'string',
              description: 'Document name'
            },
            content_hash: {
              type: 'string',
              description: 'SHA-256 hash of document content'
            },
            total_chunks: {
              type: 'integer',
              description: 'Total number of chunks'
            },
            loaded_chunks: {
              type: 'integer',
              description: 'Number of processed chunks'
            },
            metadata: {
              type: 'object',
              description: 'Document metadata'
            },
            created_at: {
              type: 'string',
              format: 'date-time',
              description: 'Creation timestamp'
            },
            external_id: {
              type: 'string',
              description: 'External document ID'
            },
            project: {
              type: 'string',
              description: 'Project name'
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
              description: 'Total number of documents'
            },
            page: {
              type: 'integer',
              description: 'Current page number'
            },
            limit: {
              type: 'integer',
              description: 'Number of items per page'
            },
            total_pages: {
              type: 'integer',
              description: 'Total number of pages'
            }
          }
        },
        ChatMessage: {
          type: 'object',
          properties: {
            role: {
              type: 'string',
              enum: ['system', 'user', 'assistant'],
              description: 'Message role'
            },
            content: {
              type: 'string',
              description: 'Message content'
            }
          }
        },
        ChatCompletion: {
          type: 'object',
          properties: {
            model: {
              type: 'string',
              description: 'Model name'
            },
            messages: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/ChatMessage'
              }
            },
            temperature: {
              type: 'number',
              description: 'Sampling temperature'
            },
            max_tokens: {
              type: 'integer',
              description: 'Maximum number of tokens to generate'
            },
            stream: {
              type: 'boolean',
              description: 'Whether to stream the response'
            }
          }
        },
        RagRequest: {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description: 'User question'
            },
            project: {
              type: 'string',
              description: 'Project name'
            },
            model: {
              type: 'string',
              description: 'Model name for answer generation'
            }
          }
        }
      }
    },
    security: [{
      ApiKeyAuth: []
    }],
    tags: [
      {
        name: 'Documents',
        description: 'Document management endpoints'
      },
      {
        name: 'AI',
        description: 'AI and RAG endpoints'
      },
      {
        name: 'Chat',
        description: 'OpenAI-compatible chat completion endpoints'
      }
    ]
  },
  apis: ['./src/routes/*.js']
};

export const specs = swaggerJsdoc(options); 