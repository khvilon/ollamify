import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as z from 'zod/v4';

import DocumentQueries from '../db/documents.js';
import ProjectQueries from '../db/projects.js';
import qdrantClient from '../db/qdrant.js';
import { searchDocuments } from '../services/retrieval.js';
import { assertValidProjectName } from '../utils/projectNames.js';
import {
  RAG_SYSTEM_PROMPT,
  buildRagContextFromDocs,
  buildRagMessages
} from '../utils/ragPrompt.js';
import { buildMcpToolResult, normalizeMcpRagContextInput } from './tools.js';

export const OLLAMIFY_MCP_TOOL_NAMES = [
  'ollamify_rag_context',
  'ollamify_get_document',
  'ollamify_get_document_chunks'
];
export const OLLAMIFY_MCP_RESOURCE_NAMES = [];

const MCP_RAG_SURVEY_CONCURRENCY = Math.max(1, Number(process.env.MCP_RAG_SURVEY_CONCURRENCY) || 3);

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

function sourceFromDoc(doc, { includeContent = false, maxContentChars = 1200 } = {}) {
  const source = {
    filename: doc.filename,
    project: doc.project,
    document_id: doc.document_id,
    chunk_index: doc.chunk_index,
    similarity: doc.similarity,
    metadata: doc.metadata || {},
    extracted_metadata: doc.extracted_metadata || {}
  };

  if (includeContent) {
    const content = (doc.content || '').trim();
    source.content = content.length > maxContentChars
      ? `${content.slice(0, Math.max(0, maxContentChars - 18)).trim()}\n[truncated]`
      : content;
  }

  return source;
}

function docsWithProjectMetadata(docs) {
  return docs.map(doc => ({
    ...doc,
    metadata: {
      ...(doc.metadata || {}),
      source_project: doc.project
    }
  }));
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function buildSurveyPayload(options) {
  const projects = (await ProjectQueries.findAll()).slice(0, options.surveyProjectLimit);
  const projectSurvey = await mapWithConcurrency(projects, MCP_RAG_SURVEY_CONCURRENCY, async project => {
    try {
      const result = await searchDocuments({
        query: options.query,
        project: project.name,
        mode: options.mode,
        limit: options.surveyChunksPerProject,
        useReranker: false,
        smartSelect: false,
        includeAdjacentChunks: false,
        minScore: options.minScore,
        keywords: options.keywords
      });
      const topSources = result.relevantDocuments.map(doc => sourceFromDoc(doc, {
        includeContent: true,
        maxContentChars: 900
      }));
      const maxSimilarity = topSources.reduce((max, source) => (
        typeof source.similarity === 'number' ? Math.max(max, source.similarity) : max
      ), 0);

      return {
        project: project.name,
        description: project.description || '',
        sourceCount: topSources.length,
        maxSimilarity,
        topSources,
        intentQuery: result.intentQuery,
        keywords: result.keywords
      };
    } catch (error) {
      return {
        project: project.name,
        description: project.description || '',
        sourceCount: 0,
        maxSimilarity: 0,
        topSources: [],
        error: error.message
      };
    }
  });

  return {
    query: options.query,
    strategy: 'survey',
    mode: options.mode,
    instruction: 'Choose one to three project names from projectSurvey that are most likely to contain the answer, then call ollamify_rag_context again with strategy "deep" and projects set to those exact names. Do not answer from survey unless the survey snippets fully answer the question.',
    surveyChunksPerProject: options.surveyChunksPerProject,
    surveyProjectLimit: options.surveyProjectLimit,
    projectSurvey: projectSurvey
      .filter(item => item.sourceCount > 0 || item.error)
      .sort((a, b) => (b.maxSimilarity || 0) - (a.maxSimilarity || 0))
  };
}

async function buildDeepPayload(options) {
  if (options.projects.length === 0) {
    throw new Error('Deep RAG context requires project or projects selected from a prior survey');
  }

  const projectResults = await mapWithConcurrency(options.projects, MCP_RAG_SURVEY_CONCURRENCY, async project => {
    const result = await searchDocuments({
      query: options.query,
      project,
      mode: options.mode,
      limit: options.deepLimitPerProject,
      useReranker: options.useReranker,
      smartSelect: options.smartSelect,
      includeAdjacentChunks: options.includeAdjacentChunks,
      minScore: options.minScore,
      keywords: options.keywords
    });

    return {
      project,
      result
    };
  });

  const relevantDocuments = projectResults.flatMap(projectResult => projectResult.result.relevantDocuments);
  const context = buildRagContextFromDocs(docsWithProjectMetadata(relevantDocuments), options.contextCharLimit);
  const messages = buildRagMessages({
    question: options.query,
    context
  });
  const sources = relevantDocuments.map(doc => sourceFromDoc(doc));

  return {
    query: options.query,
    strategy: 'deep',
    project: options.projects.length === 1 ? options.projects[0] : null,
    projects: options.projects,
    mode: options.mode,
    limitApplied: options.deepLimitPerProject,
    projectResults: projectResults.map(projectResult => ({
      project: projectResult.project,
      sourceCount: projectResult.result.relevantDocuments.length,
      intentQuery: projectResult.result.intentQuery,
      keywords: projectResult.result.keywords,
      mode: projectResult.result.mode,
      limitApplied: projectResult.result.limitApplied
    })),
    systemPrompt: RAG_SYSTEM_PROMPT,
    userPrompt: messages[1].content,
    messages,
    context,
    sources
  };
}

export function createOllamifyMcpServer() {
  const server = new McpServer({
    name: 'ollamify',
    version: '1.0.0'
  });

  server.registerTool(
    'ollamify_rag_context',
    {
      title: 'Get Ollamify RAG context',
      description: 'Guided RAG retrieval for answering a question. Without project/projects, returns a per-project survey; call again with strategy="deep" and selected projects to get final messages/context. Does not call an internal LLM.',
      inputSchema: {
        query: z.string().optional().describe('Search query. Alias: question.'),
        question: z.string().optional().describe('Search query alias for clients that prefer question.'),
        strategy: z.enum(['survey', 'deep']).optional().describe('survey: get top snippets from each project for project selection. deep: get final RAG context from selected project(s). Defaults to survey when no project is provided, deep when project/projects are provided.'),
        project: z.string().optional().describe('Single selected project for deep mode. If omitted with no projects, returns a survey instead of global deep search.'),
        projects: z.array(z.string()).optional().describe('Selected projects for deep mode. Use exact project names returned by survey.'),
        mode: z.enum(['vector', 'keyword', 'hybrid']).optional().describe('Retrieval mode. Defaults to hybrid.'),
        limit: z.number().int().min(1).max(100).optional().describe('Maximum chunks to retrieve before RAG context formatting. Defaults to 30.'),
        surveyChunksPerProject: z.number().int().min(1).max(5).optional().describe('Survey snippets to retrieve from each project. Defaults to 2.'),
        surveyProjectLimit: z.number().int().min(1).max(50).optional().describe('Maximum projects to survey. Defaults to 50.'),
        deepLimitPerProject: z.number().int().min(1).max(100).optional().describe('Chunks to retrieve per selected project in deep mode. Defaults to 30.'),
        useReranker: z.boolean().optional().describe('Enable reranker service if available. Defaults to true.'),
        rerank: z.boolean().optional().describe('Alias for useReranker.'),
        includeAdjacentChunks: z.boolean().optional().describe('Include neighboring chunks around matched chunks. Defaults to true.'),
        smartSelect: z.boolean().optional().describe('Apply the same score-drop selection used by /api/ai/rag. Defaults to true.'),
        contextCharLimit: z.number().int().min(0).max(50000).optional().describe('Maximum characters in the returned RAG context. Defaults to RAG_CONTEXT_CHAR_LIMIT or 6000. Use 0 for unlimited.'),
        minScore: z.number().optional().describe('Optional minimum similarity score filter.'),
        keywords: z.array(z.string()).optional().describe('Optional exact keywords or phrases for keyword/hybrid search.')
      }
    },
    async args => {
      const options = normalizeMcpRagContextInput(args);
      const payload = options.strategy === 'survey'
        ? await buildSurveyPayload(options)
        : await buildDeepPayload(options);

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
