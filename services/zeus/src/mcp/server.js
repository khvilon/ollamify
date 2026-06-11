import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import DocumentQueries from '../db/documents.js';
import ProjectQueries from '../db/projects.js';
import qdrantClient from '../db/qdrant.js';
import { searchDocuments } from '../services/retrieval.js';
import { assertValidProjectName } from '../utils/projectNames.js';
import { buildMcpToolResult, normalizeMcpSearchInput } from './tools.js';

function serializeProject(project, stats = undefined) {
  const payload = {
    id: project.id,
    name: project.name,
    description: project.description || '',
    embedding_model: project.embedding_model,
    created_at: project.created_at,
    created_by: project.created_by,
    creator_email: project.creator_email,
    creator_username: project.creator_username
  };

  if (stats !== undefined) {
    payload.stats = stats;
  }

  return payload;
}

async function listProjects({ includeStats = false } = {}) {
  const projects = await ProjectQueries.findAll();

  if (!includeStats) {
    return projects.map(project => serializeProject(project));
  }

  return Promise.all(projects.map(async project => {
    try {
      const stats = await ProjectQueries.getStats(project.name);
      return serializeProject(project, stats);
    } catch (error) {
      return serializeProject(project, {
        error: error.message
      });
    }
  }));
}

function normalizeDocumentId(documentId) {
  const numericId = Number(documentId);
  if (!Number.isInteger(numericId) || numericId < 1) {
    throw new Error('documentId must be a positive integer');
  }
  return numericId;
}

function normalizeChunkWindow(startChunkIndex = 0, limit = 10) {
  const numericStart = Number(startChunkIndex);
  const numericLimit = Number(limit);
  const start = Number.isInteger(numericStart) && numericStart >= 0 ? numericStart : 0;
  const chunkLimit = Number.isFinite(numericLimit)
    ? Math.min(50, Math.max(1, Math.floor(numericLimit)))
    : 10;

  return {
    start,
    limit: chunkLimit
  };
}

export function createOllamifyMcpServer() {
  const server = new McpServer({
    name: 'ollamify',
    version: '1.0.0'
  });

  server.registerResource(
    'ollamify-projects',
    'ollamify://projects',
    {
      title: 'Ollamify projects',
      description: 'Projects available in this Ollamify instance, including descriptions for agent orientation.',
      mimeType: 'application/json'
    },
    async uri => {
      const projects = await listProjects();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ projects }, null, 2)
          }
        ]
      };
    }
  );

  server.registerTool(
    'ollamify_list_projects',
    {
      title: 'List Ollamify projects',
      description: 'List projects available in Ollamify with descriptions and embedding models.',
      inputSchema: {
        includeStats: z.boolean().optional().describe('Include document counts and vector database status. Defaults to false.')
      }
    },
    async ({ includeStats = false } = {}) => {
      const projects = await listProjects({ includeStats });
      return buildMcpToolResult({ projects });
    }
  );

  server.registerTool(
    'ollamify_search_documents',
    {
      title: 'Search Ollamify documents',
      description: 'Search indexed document chunks by vector, keyword, or hybrid retrieval. Uses the same retrieval service as /api/ai/rag/chunks.',
      inputSchema: {
        query: z.string().optional().describe('Search query. Alias: question.'),
        question: z.string().optional().describe('Search query alias for clients that prefer question.'),
        project: z.string().optional().describe('Project name. If omitted, searches across all projects.'),
        mode: z.enum(['vector', 'keyword', 'hybrid']).optional().describe('Retrieval mode. Defaults to hybrid.'),
        limit: z.number().int().min(1).max(100).optional().describe('Maximum chunks to return. Defaults to 10.'),
        useReranker: z.boolean().optional().describe('Enable reranker service if available. Defaults to false.'),
        rerank: z.boolean().optional().describe('Alias for useReranker.'),
        includeAdjacentChunks: z.boolean().optional().describe('Include neighboring chunks around matched chunks. Defaults to false.'),
        minScore: z.number().optional().describe('Optional minimum similarity score filter.'),
        keywords: z.array(z.string()).optional().describe('Optional exact keywords or phrases for keyword/hybrid search.'),
        includeOriginalDocuments: z.boolean().optional().describe('Include pre-rerank/pre-filter documents in the response. Defaults to false.')
      }
    },
    async args => {
      const options = normalizeMcpSearchInput(args);
      const result = await searchDocuments({
        ...options,
        useReranker: options.useReranker
      });

      const payload = {
        query: options.query,
        project: options.project || null,
        mode: result.mode,
        limitApplied: result.limitApplied,
        intentQuery: result.intentQuery,
        keywords: result.keywords,
        relevantDocuments: result.relevantDocuments
      };

      if (args?.includeOriginalDocuments) {
        payload.originalDocuments = result.originalDocuments;
      }

      return buildMcpToolResult(payload);
    }
  );

  server.registerTool(
    'ollamify_get_document',
    {
      title: 'Get Ollamify document',
      description: 'Get document metadata and first available content chunk by project and document id.',
      inputSchema: {
        project: z.string().describe('Project name.'),
        documentId: z.union([z.number().int(), z.string()]).describe('Document id from search results.')
      }
    },
    async ({ project, documentId }) => {
      const projectName = assertValidProjectName(project);
      const doc = await DocumentQueries.findById(projectName, normalizeDocumentId(documentId));
      return buildMcpToolResult({
        document: {
          ...doc,
          project: projectName
        }
      });
    }
  );

  server.registerTool(
    'ollamify_get_document_chunks',
    {
      title: 'Get Ollamify document chunks',
      description: 'Read a window of indexed chunks from a document. Useful after search returns document_id and chunk_index.',
      inputSchema: {
        project: z.string().describe('Project name.'),
        documentId: z.union([z.number().int(), z.string()]).describe('Document id from search results.'),
        startChunkIndex: z.number().int().min(0).optional().describe('First chunk index to read. Defaults to 0.'),
        limit: z.number().int().min(1).max(50).optional().describe('Number of chunks to read. Defaults to 10, max 50.')
      }
    },
    async ({ project, documentId, startChunkIndex = 0, limit = 10 }) => {
      const projectName = assertValidProjectName(project);
      const numericDocumentId = normalizeDocumentId(documentId);
      const window = normalizeChunkWindow(startChunkIndex, limit);
      const indices = Array.from({ length: window.limit }, (_, index) => window.start + index);
      const chunks = await qdrantClient.getChunksByDocumentAndIndices(projectName, numericDocumentId, indices);

      return buildMcpToolResult({
        project: projectName,
        documentId: numericDocumentId,
        startChunkIndex: window.start,
        limit: window.limit,
        chunks
      });
    }
  );

  return server;
}
