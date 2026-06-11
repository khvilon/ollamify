import pool from '../db/conf.js';
import { getEmbedding, getEmbeddingDimension } from '../embeddings.js';
import qdrantClient from '../db/qdrant.js';
import logger from '../utils/logger.js';
import { fetchWithTimeout } from '../utils/ollama.js';
import {
  buildDeterministicKeywords,
  buildDeterministicSearchQuery,
  normalizeKeywordCandidates
} from '../utils/ragSearch.js';
import { assertValidProjectName } from '../utils/projectNames.js';

function envFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

const MAX_KEYWORDS_FOR_SEARCH = 16;
const MAX_AGGREGATED_QUERY_LENGTH = 200;
const MAX_RETRIEVAL_LIMIT = 200;
const RAG_PROJECT_SEARCH_CONCURRENCY = Math.max(1, Number(process.env.RAG_PROJECT_SEARCH_CONCURRENCY) || 3);
const RAG_USE_LLM_QUERY_REWRITE = envFlag(process.env.RAG_USE_LLM_QUERY_REWRITE, false);
const RAG_USE_LLM_KEYWORDS = envFlag(process.env.RAG_USE_LLM_KEYWORDS, false);
const RAG_INTENT_MAX_TOKENS = Math.max(1, Number(process.env.RAG_INTENT_MAX_TOKENS) || 128);
const RAG_KEYWORDS_MAX_TOKENS = Math.max(1, Number(process.env.RAG_KEYWORDS_MAX_TOKENS) || 192);
const RAG_RERANK_MAX_DOCS = Math.max(1, Number(process.env.RAG_RERANK_MAX_DOCS) || 8);
const RAG_RERANK_MAX_RETRIES = Math.max(1, Number(process.env.RAG_RERANK_MAX_RETRIES) || 1);
const RAG_RERANK_TIMEOUT_MS = Math.max(100, Number(process.env.RAG_RERANK_TIMEOUT_MS) || 5000);
const RAG_RERANK_MAX_TIMEOUT_MS = Math.max(RAG_RERANK_TIMEOUT_MS, Number(process.env.RAG_RERANK_MAX_TIMEOUT_MS) || 10000);
const RAG_RERANK_TIMEOUT_INCREMENT_MS = Math.max(0, Number(process.env.RAG_RERANK_TIMEOUT_INCREMENT_MS) || 1000);
const RAG_RERANK_HEALTH_TIMEOUT_MS = Math.max(100, Number(process.env.RAG_RERANK_HEALTH_TIMEOUT_MS) || 1000);
const RAG_RERANK_HEALTH_CACHE_MS = Math.max(0, Number(process.env.RAG_RERANK_HEALTH_CACHE_MS) || 10000);
const RAG_ADJACENT_CHUNK_RADIUS = Math.max(0, Number(process.env.RAG_ADJACENT_CHUNK_RADIUS) || 1);
const RAG_ADJACENT_CHUNK_MAX_BASE_DOCS = Math.max(0, Number(process.env.RAG_ADJACENT_CHUNK_MAX_BASE_DOCS) || 8);
const RAG_ADJACENT_CHUNK_MAX_TOTAL = Math.max(1, Number(process.env.RAG_ADJACENT_CHUNK_MAX_TOTAL) || 24);

let rerankerHealthCache = {
  ok: false,
  checkedAt: 0
};

export function normalizeBooleanOption(value, defaultValue = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  return defaultValue;
}

export function normalizeSearchMode(mode, legacyUseHybridSearch = undefined) {
  if (typeof mode === 'string') {
    const normalized = mode.trim().toLowerCase();
    if (['vector', 'keyword', 'hybrid'].includes(normalized)) {
      return normalized;
    }
  }

  if (legacyUseHybridSearch !== undefined) {
    return normalizeBooleanOption(legacyUseHybridSearch, true) ? 'hybrid' : 'vector';
  }

  return 'hybrid';
}

export function normalizeRetrievalOptions(options = {}) {
  const rawLimit = Number(options.limit);
  const limit = Math.min(
    MAX_RETRIEVAL_LIMIT,
    Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 20)
  );

  const rawMinScore = Number(options.minScore);
  const minScore = Number.isFinite(rawMinScore) ? rawMinScore : null;

  return {
    mode: normalizeSearchMode(options.mode, options.useHybridSearch),
    limit,
    useReranker: normalizeBooleanOption(options.useReranker ?? options.rerank, false),
    includeAdjacentChunks: normalizeBooleanOption(options.includeAdjacentChunks, false),
    smartSelect: normalizeBooleanOption(options.smartSelect, false),
    minScore,
    keywords: Array.isArray(options.keywords) ? options.keywords : [],
    model: typeof options.model === 'string' ? options.model.trim() : '',
    completionProvider: typeof options.completionProvider === 'function' ? options.completionProvider : null
  };
}

export function serializeRetrievedDocument(doc) {
  return {
    filename: doc?.filename || 'unknown',
    content: doc?.content || '',
    project: doc?.project,
    document_id: doc?.document_id,
    chunk_index: doc?.chunk_index,
    similarity: typeof doc?.similarity === 'number' ? doc.similarity : 0,
    metadata: doc?.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
      ? doc.metadata
      : {}
  };
}

function ragChunkKey(doc) {
  const documentId = Number(doc?.document_id);
  const chunkIndex = Number(doc?.chunk_index);

  if (Number.isInteger(documentId) && Number.isInteger(chunkIndex)) {
    return `${doc.project || ''}:${documentId}:${chunkIndex}`;
  }

  return `${doc?.project || ''}:${doc?.filename || ''}:${(doc?.content || '').slice(0, 300)}`;
}

function hasChunkCoordinates(doc) {
  return Number.isInteger(Number(doc?.document_id)) && Number.isInteger(Number(doc?.chunk_index));
}

export async function expandRagChunksWithNeighbors(docs, project) {
  if (
    RAG_ADJACENT_CHUNK_RADIUS <= 0 ||
    RAG_ADJACENT_CHUNK_MAX_BASE_DOCS <= 0 ||
    !Array.isArray(docs) ||
    docs.length === 0
  ) {
    return docs;
  }

  const expandedDocs = [];
  const seen = new Set();
  const addDoc = doc => {
    if (!doc || !doc.content) {
      return;
    }

    const key = ragChunkKey(doc);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    expandedDocs.push(doc);
  };

  for (let index = 0; index < docs.length; index += 1) {
    const doc = docs[index];

    if (index >= RAG_ADJACENT_CHUNK_MAX_BASE_DOCS || !hasChunkCoordinates(doc)) {
      addDoc(doc);
      continue;
    }

    const baseChunkIndex = Number(doc.chunk_index);
    const neighborIndices = [];

    for (let offset = -RAG_ADJACENT_CHUNK_RADIUS; offset <= RAG_ADJACENT_CHUNK_RADIUS; offset += 1) {
      if (offset === 0) {
        continue;
      }

      const candidateIndex = baseChunkIndex + offset;
      if (candidateIndex >= 0) {
        neighborIndices.push(candidateIndex);
      }
    }

    let neighbors = [];
    if (neighborIndices.length > 0) {
      neighbors = await qdrantClient.getChunksByDocumentAndIndices(project, doc.document_id, neighborIndices);
    }

    const previousNeighbors = neighbors.filter(neighbor => Number(neighbor.chunk_index) < baseChunkIndex);
    const nextNeighbors = neighbors.filter(neighbor => Number(neighbor.chunk_index) > baseChunkIndex);

    for (const neighbor of previousNeighbors) {
      addDoc({
        ...neighbor,
        similarity: doc.similarity,
        metadata: {
          ...(neighbor.metadata || {}),
          __adjacentToChunk: baseChunkIndex
        }
      });
    }

    addDoc(doc);

    for (const neighbor of nextNeighbors) {
      addDoc({
        ...neighbor,
        similarity: doc.similarity,
        metadata: {
          ...(neighbor.metadata || {}),
          __adjacentToChunk: baseChunkIndex
        }
      });
    }

    if (expandedDocs.length >= RAG_ADJACENT_CHUNK_MAX_TOTAL) {
      break;
    }
  }

  return expandedDocs.slice(0, RAG_ADJACENT_CHUNK_MAX_TOTAL);
}

async function expandAcrossProjects(docs, explicitProject) {
  if (explicitProject) {
    return expandRagChunksWithNeighbors(docs, explicitProject);
  }

  const grouped = new Map();
  for (const doc of docs) {
    if (!doc?.project) {
      continue;
    }
    if (!grouped.has(doc.project)) {
      grouped.set(doc.project, []);
    }
    grouped.get(doc.project).push(doc);
  }

  if (grouped.size === 0) {
    return docs;
  }

  const expanded = [];
  for (const [project, projectDocs] of grouped.entries()) {
    expanded.push(...await expandRagChunksWithNeighbors(projectDocs, project));
  }
  return expanded;
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

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function findRelevantDocuments(questionEmbedding, project, embeddingModel, limit) {
  try {
    const collectionExists = await qdrantClient.collectionExists(project);

    if (!collectionExists) {
      logger.info(`Creating new collection for project ${project}`);
      const dimension = await getEmbeddingDimension(embeddingModel);
      await qdrantClient.createCollection(project, dimension);
    }

    const filter = {
      must: [
        { key: 'project', match: { value: project } }
      ]
    };

    logger.info(`Searching Qdrant with strict project filter for: ${project}`);
    const relevantDocs = await qdrantClient.search(project, questionEmbedding, limit, filter);

    logger.info(`Found ${relevantDocs.length} relevant documents in Qdrant for project ${project}`);
    const wrongProjectDocs = relevantDocs.filter(doc => doc.project !== project);
    if (wrongProjectDocs.length > 0) {
      logger.warn(`Warning: Found ${wrongProjectDocs.length} documents from wrong projects: ${wrongProjectDocs.map(d => d.project).join(', ')}`);
    }

    return relevantDocs;
  } catch (error) {
    logger.error(`Error finding relevant documents for project ${project}:`, error);
    throw error;
  }
}

async function findKeywordDocuments(keywords, project, limit = 20) {
  const sanitizedKeywords = Array.isArray(keywords)
    ? normalizeKeywordCandidates(keywords, MAX_KEYWORDS_FOR_SEARCH)
    : [];

  if (sanitizedKeywords.length === 0) {
    logger.info('No keywords provided for keyword-based search');
    return [];
  }

  const docMap = new Map();

  const addDocsToMap = (docs, matchLabel) => {
    docs.forEach(doc => {
      if (!doc || !doc.content) {
        return;
      }

      const docKey = `${doc.project || project}::${doc.filename || 'unknown'}::${doc.content.substring(0, 300)}`;

      if (!docMap.has(docKey)) {
        docMap.set(docKey, {
          filename: doc.filename || 'unknown',
          content: doc.content,
          project: doc.project || project,
          document_id: doc.document_id,
          chunk_index: doc.chunk_index,
          metadata: doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
            ? { ...doc.metadata }
            : {},
          keywordScore: typeof doc.similarity === 'number' ? doc.similarity : 0,
          similarity: typeof doc.similarity === 'number' ? doc.similarity : 0,
          keywordMatches: new Set()
        });
      }

      const entry = docMap.get(docKey);
      const docScore = typeof doc.similarity === 'number' ? doc.similarity : 0;

      if (entry.document_id === undefined && doc.document_id !== undefined) {
        entry.document_id = doc.document_id;
      }
      if (entry.chunk_index === undefined && doc.chunk_index !== undefined) {
        entry.chunk_index = doc.chunk_index;
      }

      entry.keywordScore = Math.max(entry.keywordScore, docScore);
      entry.similarity = Math.max(entry.similarity, docScore);

      if (doc.metadata && doc.metadata.__keywordMatches && Array.isArray(doc.metadata.__keywordMatches)) {
        doc.metadata.__keywordMatches.forEach(match => entry.keywordMatches.add(match));
      }

      if (matchLabel) {
        entry.keywordMatches.add(matchLabel);
      }
    });
  };

  const aggregatedKeywordsSubset = sanitizedKeywords.slice(0, Math.min(sanitizedKeywords.length, 5));
  const aggregatedQuery = aggregatedKeywordsSubset.join(' ');
  const aggregatedQueryForSearch = aggregatedQuery.length > MAX_AGGREGATED_QUERY_LENGTH
    ? aggregatedQuery.slice(0, MAX_AGGREGATED_QUERY_LENGTH)
    : aggregatedQuery;

  try {
    if (aggregatedQueryForSearch.length > 0) {
      logger.info('Running aggregated keyword search in Qdrant:', {
        project,
        aggregatedQuery: aggregatedQueryForSearch
      });

      const aggregatedDocs = await qdrantClient.searchByText(project, aggregatedQueryForSearch, limit);
      addDocsToMap(aggregatedDocs, aggregatedQueryForSearch);
    }

    const perKeywordLimit = Math.max(3, Math.ceil(limit / Math.min(sanitizedKeywords.length, 5)));

    for (const keyword of sanitizedKeywords) {
      logger.info('Running keyword search in Qdrant:', {
        project,
        keyword
      });

      const keywordDocs = await qdrantClient.searchByText(project, keyword, perKeywordLimit);
      addDocsToMap(keywordDocs, keyword);
    }
  } catch (error) {
    logger.error('Error during keyword search in Qdrant:', error);
  }

  const keywordDocs = Array.from(docMap.values()).map(entry => {
    const keywordMatches = Array.from(entry.keywordMatches);
    const metadata = { ...entry.metadata };

    if (keywordMatches.length > 0) {
      metadata.__keywordMatches = keywordMatches;
    }

    metadata.__keywordScore = entry.keywordScore;

    return {
      filename: entry.filename,
      content: entry.content,
      project: entry.project,
      document_id: entry.document_id,
      chunk_index: entry.chunk_index,
      similarity: entry.keywordScore,
      keywordScore: entry.keywordScore,
      metadata
    };
  });

  logger.info('Keyword search summary:', {
    project,
    keywords: sanitizedKeywords,
    aggregatedQuery: aggregatedQueryForSearch,
    totalUniqueDocuments: keywordDocs.length
  });

  return keywordDocs;
}

function createScoreNormalizer(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return () => 0;
  }

  const numericValues = values.filter(value => typeof value === 'number' && !Number.isNaN(value));

  if (numericValues.length === 0) {
    return () => 0;
  }

  const max = Math.max(...numericValues);
  const min = Math.min(...numericValues);
  const range = max - min;

  if (range === 0) {
    return () => 1;
  }

  return value => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 0;
    }
    return (value - min) / range;
  };
}

function mergeHybridResults(embeddingDocs, keywordDocs, limit) {
  const docMap = new Map();

  const makeKey = doc => {
    const project = doc.project || 'unknown_project';
    const filename = doc.filename || 'unknown_file';
    const contentPreview = doc.content ? doc.content.substring(0, 400) : '';
    return `${project}::${filename}::${contentPreview}`;
  };

  const addDoc = (doc, source) => {
    if (!doc || !doc.content) {
      return;
    }

    const key = makeKey(doc);

    if (!docMap.has(key)) {
      docMap.set(key, {
        filename: doc.filename || 'unknown',
        content: doc.content,
        project: doc.project,
        document_id: doc.document_id,
        chunk_index: doc.chunk_index,
        metadata: doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
          ? { ...doc.metadata }
          : {},
        embeddingScore: null,
        keywordScore: null,
        keywordMatches: new Set(),
        sources: new Set()
      });
    }

    const entry = docMap.get(key);

    if (entry.document_id === undefined && doc.document_id !== undefined) {
      entry.document_id = doc.document_id;
    }
    if (entry.chunk_index === undefined && doc.chunk_index !== undefined) {
      entry.chunk_index = doc.chunk_index;
    }

    if (source === 'embedding' && typeof doc.similarity === 'number' && !Number.isNaN(doc.similarity)) {
      entry.embeddingScore = entry.embeddingScore !== null
        ? Math.max(entry.embeddingScore, doc.similarity)
        : doc.similarity;
    }

    if (source === 'keyword') {
      const keywordScoreCandidate = typeof doc.keywordScore === 'number' && !Number.isNaN(doc.keywordScore)
        ? doc.keywordScore
        : (typeof doc.similarity === 'number' && !Number.isNaN(doc.similarity) ? doc.similarity : null);

      if (keywordScoreCandidate !== null) {
        entry.keywordScore = entry.keywordScore !== null
          ? Math.max(entry.keywordScore, keywordScoreCandidate)
          : keywordScoreCandidate;
      }

      if (doc.metadata && Array.isArray(doc.metadata.__keywordMatches)) {
        doc.metadata.__keywordMatches.forEach(match => entry.keywordMatches.add(match));
      }
    }

    entry.sources.add(source);
  };

  embeddingDocs.forEach(doc => addDoc(doc, 'embedding'));
  keywordDocs.forEach(doc => addDoc(doc, 'keyword'));

  const entries = Array.from(docMap.values());
  const embeddingScores = entries
    .map(entry => entry.embeddingScore)
    .filter(value => typeof value === 'number' && !Number.isNaN(value));
  const keywordScores = entries
    .map(entry => entry.keywordScore)
    .filter(value => typeof value === 'number' && !Number.isNaN(value));

  const normalizeEmbedding = createScoreNormalizer(embeddingScores);
  const normalizeKeyword = createScoreNormalizer(keywordScores);

  const mergedDocs = entries.map(entry => {
    const sources = Array.from(entry.sources);
    const hasEmbedding = entry.embeddingScore !== null;
    const hasKeyword = entry.keywordScore !== null;
    const normalizedEmbedding = hasEmbedding ? normalizeEmbedding(entry.embeddingScore) : 0;
    const normalizedKeyword = hasKeyword ? normalizeKeyword(entry.keywordScore) : 0;
    const hybridScore = hasEmbedding && hasKeyword
      ? (0.7 * normalizedEmbedding) + (0.3 * normalizedKeyword) + 0.1
      : (hasEmbedding ? normalizedEmbedding : normalizedKeyword);
    const metadata = { ...entry.metadata };
    const keywordMatches = Array.from(entry.keywordMatches);

    metadata.__retrieval = {
      sources,
      embeddingScore: entry.embeddingScore,
      keywordScore: entry.keywordScore,
      hybridScore
    };

    if (keywordMatches.length > 0) {
      metadata.__keywordMatches = keywordMatches;
    }

    return {
      filename: entry.filename,
      content: entry.content,
      project: entry.project,
      document_id: entry.document_id,
      chunk_index: entry.chunk_index,
      similarity: hybridScore,
      metadata
    };
  });

  return mergedDocs
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, limit);
}

export async function getRelevantChunks(question, project, limit = 100, options = {}) {
  const normalizedOptions = normalizeRetrievalOptions({ ...options, limit });
  const numericLimit = normalizedOptions.limit;
  const mode = normalizedOptions.mode;
  const runVectorSearch = mode === 'vector' || mode === 'hybrid';
  const runKeywordSearch = mode === 'keyword' || mode === 'hybrid';
  const sanitizedKeywords = runKeywordSearch
    ? normalizeKeywordCandidates(
        normalizedOptions.keywords.length > 0
          ? normalizedOptions.keywords
          : buildDeterministicKeywords(question, MAX_KEYWORDS_FOR_SEARCH),
        MAX_KEYWORDS_FOR_SEARCH
      )
    : [];
  const embeddingDocs = [];
  const keywordDocs = [];
  const projectName = project ? assertValidProjectName(project) : '';

  const searchProject = async proj => {
    if (runVectorSearch) {
      logger.info('Running embedding search for project:', proj.name);
      const questionEmbedding = await getEmbedding(question, proj.embedding_model);
      const embeddingLimit = Math.max(numericLimit, Math.min(numericLimit * 2, 60));
      let projectEmbeddingDocs = await findRelevantDocuments(questionEmbedding, proj.name, proj.embedding_model, embeddingLimit);

      projectEmbeddingDocs = projectEmbeddingDocs
        .filter(doc => doc && doc.content)
        .map(doc => ({
          ...doc,
          project: proj.name
        }));

      embeddingDocs.push(...projectEmbeddingDocs);
    }

    if (runKeywordSearch && sanitizedKeywords.length > 0) {
      logger.info('Running keyword search for project:', {
        project: proj.name,
        keywords: sanitizedKeywords
      });

      const keywordLimit = Math.max(numericLimit, Math.min(numericLimit * 2, 80));
      let projectKeywordDocs = await findKeywordDocuments(sanitizedKeywords, proj.name, keywordLimit);

      projectKeywordDocs = projectKeywordDocs
        .filter(doc => doc && doc.content)
        .map(doc => ({
          ...doc,
          project: proj.name
        }));

      keywordDocs.push(...projectKeywordDocs);
    }
  };

  if (projectName) {
    logger.info(`Project specified: ${projectName}, running ${mode} retrieval within this project`, {
      keywords: sanitizedKeywords,
      mode
    });

    const projectResult = await pool.query(
      'SELECT name, embedding_model FROM admin.projects WHERE name = $1',
      [projectName]
    );

    if (projectResult.rows.length === 0) {
      throw new Error(`Project "${projectName}" not found`);
    }

    await searchProject(projectResult.rows[0]);
  } else {
    logger.info(`No project specified, running ${mode} retrieval across all projects`, {
      keywords: sanitizedKeywords,
      mode
    });

    const projectResult = await pool.query(
      'SELECT name, embedding_model FROM admin.projects'
    );

    const projects = projectResult.rows;

    if (projects.length === 0) {
      throw new Error('No projects found');
    }

    logger.info(`Searching in ${projects.length} projects: ${projects.map(p => p.name).join(', ')}`);
    await mapWithConcurrency(projects, RAG_PROJECT_SEARCH_CONCURRENCY, searchProject);
  }

  const filteredEmbeddingDocs = embeddingDocs.filter(doc => doc && doc.content);
  const filteredKeywordDocs = keywordDocs.filter(doc => doc && doc.content);
  const rankedDocs = mergeHybridResults(filteredEmbeddingDocs, filteredKeywordDocs, numericLimit);
  const projectAwareDocs = projectName
    ? rankedDocs
        .filter(doc => doc.project === projectName || !doc.project)
        .map(doc => ({
          ...doc,
          project: projectName
        }))
    : rankedDocs;
  const finalDocs = projectAwareDocs.filter(doc => doc && doc.content).slice(0, numericLimit);
  const projectStats = finalDocs.reduce((acc, doc) => {
    const docProject = doc.project || 'unknown_project';
    acc[docProject] = (acc[docProject] || 0) + 1;
    return acc;
  }, {});

  logger.info('Retrieval summary:', {
    project: projectName || 'all_projects',
    requestedLimit: numericLimit,
    keywords: sanitizedKeywords,
    mode,
    embeddingDocs: filteredEmbeddingDocs.length,
    keywordDocs: filteredKeywordDocs.length,
    returnedDocs: finalDocs.length,
    projectStats
  });

  return finalDocs;
}

async function checkRerankerHealth() {
  const now = Date.now();
  if (
    RAG_RERANK_HEALTH_CACHE_MS > 0 &&
    now - rerankerHealthCache.checkedAt < RAG_RERANK_HEALTH_CACHE_MS
  ) {
    return rerankerHealthCache.ok;
  }

  try {
    const response = await fetchWithTimeout('http://reranker:8001/health', {
      method: 'GET'
    }, RAG_RERANK_HEALTH_TIMEOUT_MS);

    rerankerHealthCache = {
      ok: response.ok,
      checkedAt: now
    };
    return response.ok;
  } catch (error) {
    rerankerHealthCache = {
      ok: false,
      checkedAt: Date.now()
    };
    logger.error('Reranker health check failed:', error);
    return false;
  }
}

export async function rerankDocuments(question, relevantDocs) {
  const docsForReranker = relevantDocs.slice(0, RAG_RERANK_MAX_DOCS);

  if (docsForReranker.length === 0) {
    return relevantDocs;
  }

  if (docsForReranker.length < relevantDocs.length) {
    logger.info('Limiting documents sent to reranker', {
      originalDocs: relevantDocs.length,
      rerankDocs: docsForReranker.length
    });
  }

  let currentTimeout = RAG_RERANK_TIMEOUT_MS;
  let retryCount = 0;

  while (retryCount < RAG_RERANK_MAX_RETRIES) {
    try {
      const isHealthy = await checkRerankerHealth();
      if (!isHealthy) {
        throw new Error('Reranker service is not healthy');
      }

      logger.info(`Sending documents to reranker service (timeout: ${currentTimeout}ms, docs: ${docsForReranker.length})`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), currentTimeout);
      const startTime = Date.now();
      const response = await fetch('http://reranker:8001/rerank', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: question,
          documents: docsForReranker
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const processingTime = Date.now() - startTime;

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Reranker service error: ${error}`);
      }

      const data = await response.json();
      logger.info(`Reranker processing completed in ${processingTime}ms`);

      if (!Array.isArray(data.reranked_documents)) {
        return relevantDocs;
      }

      const rerankerDocKey = doc => `${doc?.filename || ''}::${(doc?.content || '').slice(0, 500)}`;
      const docsByRerankerKey = new Map(docsForReranker.map(doc => [rerankerDocKey(doc), doc]));
      let rerankedDocs = data.reranked_documents.map(doc => {
        const originalDoc = docsByRerankerKey.get(rerankerDocKey(doc)) || {};
        return {
          ...originalDoc,
          ...doc,
          metadata: {
            ...(originalDoc.metadata || {}),
            ...(doc.metadata || {})
          }
        };
      });

      const hasNegative = rerankedDocs.some(doc => doc.similarity < 0);
      const needsNormalization = hasNegative || rerankedDocs.some(doc => doc.similarity > 1);

      if (needsNormalization) {
        const newSimilarities = rerankedDocs.map(doc => doc.similarity);
        const minNewSim = Math.min(...newSimilarities);
        const maxNewSim = Math.max(...newSimilarities);
        const range = maxNewSim - minNewSim;

        rerankedDocs = rerankedDocs.map(doc => ({
          ...doc,
          similarity: range > 0 ? (doc.similarity - minNewSim) / range : 0.5
        }));
      }

      logger.info('Documents reranked successfully');
      return [
        ...rerankedDocs,
        ...relevantDocs.slice(docsForReranker.length)
      ];
    } catch (error) {
      retryCount++;
      const errorType = error.name === 'AbortError' ? 'timeout' : 'service_error';
      logger.error(`Error calling reranker service (attempt ${retryCount}/${RAG_RERANK_MAX_RETRIES}, type: ${errorType}):`, error);
      if (/cuda out of memory|out of memory|\boom\b/i.test(error.message || '')) {
        logger.warn('Reranker ran out of GPU memory, returning original documents without retry');
        return relevantDocs;
      }

      if (retryCount < RAG_RERANK_MAX_RETRIES) {
        currentTimeout = Math.min(currentTimeout + RAG_RERANK_TIMEOUT_INCREMENT_MS, RAG_RERANK_MAX_TIMEOUT_MS);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        logger.error('Failed to rerank documents after all retries, returning original order');
        return relevantDocs;
      }
    }
  }

  return relevantDocs;
}

async function extractQueryIntent(originalQuery, model, completionProvider) {
  try {
    if (!RAG_USE_LLM_QUERY_REWRITE || !model || !completionProvider) {
      const intentQuery = buildDeterministicSearchQuery(originalQuery);
      logger.info('Built deterministic intent query:', {
        originalQuery,
        intentQuery
      });

      return {
        originalQuery,
        intentQuery: intentQuery || originalQuery
      };
    }

    const messages = [
      {
        role: 'system',
        content: 'Extract a concise semantic search query from the user question. Return only the query text.'
      },
      {
        role: 'user',
        content: originalQuery
      }
    ];

    const extractedIntent = await completionProvider(messages, model, false, { maxTokens: RAG_INTENT_MAX_TOKENS });
    const intentQuery = typeof extractedIntent === 'string' && extractedIntent.trim()
      ? extractedIntent.trim()
      : originalQuery;
    logger.info('Extracted intent query:', {
      originalQuery,
      intentQuery,
      model
    });

    return {
      originalQuery,
      intentQuery
    };
  } catch (error) {
    logger.error('Error extracting query intent:', error);
    return {
      originalQuery,
      intentQuery: originalQuery
    };
  }
}

async function extractKeywords(originalQuery, model, maxKeywords = 8, completionProvider = null) {
  try {
    const deterministicKeywords = buildDeterministicKeywords(
      originalQuery,
      Math.max(maxKeywords, MAX_KEYWORDS_FOR_SEARCH)
    );

    if (!RAG_USE_LLM_KEYWORDS || !completionProvider) {
      logger.info('Built deterministic keywords:', {
        query: originalQuery,
        keywords: deterministicKeywords
      });
      return deterministicKeywords;
    }

    const targetModel = model || process.env.OPENROUTER_MODEL;

    if (!targetModel) {
      return deterministicKeywords;
    }

    const messages = [
      {
        role: 'system',
        content: `Extract up to ${maxKeywords} exact search keywords or short phrases. Return one keyword per line.`
      },
      {
        role: 'user',
        content: originalQuery
      }
    ];

    const response = await completionProvider(messages, targetModel, false, { maxTokens: RAG_KEYWORDS_MAX_TOKENS });
    const strippedResponse = typeof response === 'string' ? response.trim() : '';
    let keywordCandidates = strippedResponse
      .split(/\r?\n|,/)
      .map(value => value.trim())
      .filter(Boolean);

    if (keywordCandidates.length === 0) {
      const regexMatches = strippedResponse.match(/[\p{L}\p{N}]+(?:[\s-][\p{L}\p{N}]+){0,3}/gu);
      keywordCandidates = regexMatches || [];
      if (keywordCandidates.length === 0 && originalQuery) {
        const originalRegexMatches = originalQuery.match(/[\p{L}\p{N}]+(?:[\s-][\p{L}\p{N}]+){0,3}/gu);
        keywordCandidates = originalRegexMatches || [];
      }
    }

    const normalizedKeywords = normalizeKeywordCandidates(keywordCandidates, maxKeywords);

    logger.info('Keywords extracted:', { keywords: normalizedKeywords });

    return normalizedKeywords.length > 0 ? normalizedKeywords : deterministicKeywords;
  } catch (error) {
    logger.error('Error extracting keywords:', error);
    return [];
  }
}

export async function prepareRetrievalQuery(question, options = {}) {
  const normalizedOptions = normalizeRetrievalOptions(options);
  const intentPromise = extractQueryIntent(
    question,
    normalizedOptions.model,
    normalizedOptions.completionProvider
  );
  const keywordPromise = normalizedOptions.mode === 'keyword' || normalizedOptions.mode === 'hybrid'
    ? extractKeywords(
        question,
        normalizedOptions.model,
        MAX_KEYWORDS_FOR_SEARCH,
        normalizedOptions.completionProvider
      )
    : Promise.resolve([]);
  const [intentResult, keywords] = await Promise.all([intentPromise, keywordPromise]);

  return {
    originalQuery: intentResult.originalQuery,
    intentQuery: intentResult.intentQuery,
    keywords
  };
}

export function smartDocumentSelection(documents, maxDocs = 8) {
  if (!documents || documents.length === 0) {
    logger.warn('smartDocumentSelection called with empty documents array');
    return [];
  }

  if (documents.length === 1) {
    logger.info('smartDocumentSelection: only one document available, returning it without analysis');
    return documents;
  }

  const hasInvalidSimilarity = documents.some(doc =>
    typeof doc !== 'object' ||
    doc === null ||
    typeof doc.similarity !== 'number' ||
    Number.isNaN(doc.similarity)
  );

  if (hasInvalidSimilarity) {
    logger.warn('smartDocumentSelection: some documents have invalid similarity values, using safe sorting');
    const safeDocuments = documents.filter(doc =>
      doc && typeof doc === 'object' && typeof doc.similarity === 'number' && !Number.isNaN(doc.similarity)
    );

    if (safeDocuments.length === 0) {
      logger.error('No valid documents found for selection');
      return documents.slice(0, Math.min(documents.length, maxDocs));
    }

    const sortedDocs = [...safeDocuments].sort((a, b) =>
      (b.similarity || 0) - (a.similarity || 0)
    );

    return sortedDocs.slice(0, Math.min(sortedDocs.length, maxDocs));
  }

  const sortedDocs = [...documents].sort((a, b) => b.similarity - a.similarity);
  const docsToAnalyze = sortedDocs.slice(0, maxDocs);

  if (docsToAnalyze.length < 3) {
    logger.info(`smartDocumentSelection: only ${docsToAnalyze.length} documents available, returning all without analysis`);
    return docsToAnalyze;
  }

  const localDropThreshold = 0.2;
  let cutoffIndex = docsToAnalyze.length;

  for (let index = 0; index < docsToAnalyze.length - 1; index += 1) {
    const currentSim = docsToAnalyze[index].similarity;
    const nextSim = docsToAnalyze[index + 1].similarity;
    const drop = (currentSim - nextSim) / currentSim;

    if (drop > localDropThreshold) {
      cutoffIndex = index + 1;
      logger.info(`Found significant drop (${(drop * 100).toFixed(1)}%) after document ${index + 1}`);
      break;
    }
  }

  return docsToAnalyze.slice(0, Math.max(1, cutoffIndex));
}

export async function searchDocuments({
  query,
  project = '',
  mode,
  useHybridSearch,
  useReranker,
  rerank,
  includeAdjacentChunks,
  smartSelect,
  limit = 20,
  minScore,
  keywords,
  model,
  completionProvider
} = {}) {
  if (!query || !String(query).trim()) {
    throw new Error('Search query is required');
  }

  const options = normalizeRetrievalOptions({
    mode,
    useHybridSearch,
    useReranker,
    rerank,
    includeAdjacentChunks,
    smartSelect,
    limit,
    minScore,
    keywords,
    model,
    completionProvider
  });

  const retrievalQuery = await prepareRetrievalQuery(String(query), options);
  const relevantDocs = await getRelevantChunks(retrievalQuery.intentQuery, project, options.limit, {
    mode: options.mode,
    keywords: retrievalQuery.keywords,
    useHybridSearch
  });
  const originalDocuments = relevantDocs.map(serializeRetrievedDocument);
  let processedDocs = relevantDocs;

  if (options.useReranker) {
    processedDocs = await rerankDocuments(String(query), processedDocs);
  }

  if (options.smartSelect) {
    processedDocs = smartDocumentSelection(processedDocs, 20);
  }

  if (options.includeAdjacentChunks) {
    processedDocs = await expandAcrossProjects(processedDocs, project);
  }

  if (options.minScore !== null) {
    processedDocs = processedDocs.filter(doc => typeof doc.similarity === 'number' && doc.similarity >= options.minScore);
  }

  return {
    relevantDocuments: processedDocs.map(serializeRetrievedDocument),
    originalDocuments,
    originalQuery: retrievalQuery.originalQuery,
    intentQuery: retrievalQuery.intentQuery,
    keywords: retrievalQuery.keywords,
    mode: options.mode,
    limitApplied: options.limit
  };
}
