import { buildDeterministicKeywords } from '../utils/ragSearch.js';

const MCP_MAX_RAG_LIMIT = 100;
const MCP_DEFAULT_RAG_LIMIT = 30;
const MCP_DEFAULT_CONTEXT_CHAR_LIMIT = Math.max(0, Number(process.env.RAG_CONTEXT_CHAR_LIMIT) || 6000);
const MCP_MAX_SURVEY_CHUNKS_PER_PROJECT = 5;
const MCP_DEFAULT_SURVEY_CHUNKS_PER_PROJECT = 2;
const MCP_MAX_SURVEY_PROJECT_LIMIT = 50;
const MCP_DEFAULT_SURVEY_PROJECT_LIMIT = 50;
const MCP_MAX_DEEP_LIMIT_PER_PROJECT = 100;
const MCP_DEFAULT_DEEP_LIMIT_PER_PROJECT = 30;

function normalizeBoolean(value, defaultValue = false) {
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

function normalizeMode(mode) {
  if (typeof mode !== 'string') {
    return 'hybrid';
  }

  const normalized = mode.trim().toLowerCase();
  return ['vector', 'keyword', 'hybrid'].includes(normalized) ? normalized : 'hybrid';
}

function normalizeLimit(limit, defaultLimit = MCP_DEFAULT_RAG_LIMIT) {
  const numericLimit = Number(limit);
  if (!Number.isFinite(numericLimit)) {
    return defaultLimit;
  }

  return Math.min(MCP_MAX_RAG_LIMIT, Math.max(1, Math.floor(numericLimit)));
}

function normalizeBoundedInteger(value, defaultValue, maxValue) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return defaultValue;
  }

  return Math.min(maxValue, Math.max(1, Math.floor(numericValue)));
}

function normalizeContextCharLimit(contextCharLimit) {
  const numericLimit = Number(contextCharLimit);
  if (!Number.isFinite(numericLimit)) {
    return MCP_DEFAULT_CONTEXT_CHAR_LIMIT;
  }

  return Math.min(50000, Math.max(0, Math.floor(numericLimit)));
}

function normalizeKeywords(keywords) {
  if (!Array.isArray(keywords)) {
    return undefined;
  }

  const normalized = keywords
    .map(keyword => typeof keyword === 'string' ? keyword.trim() : '')
    .filter(Boolean);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeProjects(input = {}) {
  const candidates = [];

  if (typeof input.project === 'string' && input.project.trim()) {
    candidates.push(input.project.trim());
  }

  if (Array.isArray(input.projects)) {
    for (const project of input.projects) {
      if (typeof project === 'string' && project.trim()) {
        candidates.push(project.trim());
      }
    }
  }

  const seen = new Set();
  const projects = [];

  for (const project of candidates) {
    if (seen.has(project)) {
      continue;
    }

    seen.add(project);
    projects.push(project);
  }

  return projects;
}

function normalizeStrategy(strategy, projects) {
  if (typeof strategy === 'string') {
    const normalized = strategy.trim().toLowerCase();
    if (['survey', 'deep'].includes(normalized)) {
      return normalized;
    }
  }

  return projects.length > 0 ? 'deep' : 'survey';
}

function normalizeSurveyMatchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[ёЁ]/g, 'е')
    .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function surveyTextForItem(item) {
  const parts = [
    item?.project,
    item?.description
  ];

  for (const source of Array.isArray(item?.topSources) ? item.topSources : []) {
    parts.push(
      source?.filename,
      source?.content,
      JSON.stringify(source?.metadata || {}),
      JSON.stringify(source?.extracted_metadata || {})
    );
  }

  return normalizeSurveyMatchText(parts.filter(Boolean).join(' '));
}

function calculateSurveyTextMatchScore(query, item) {
  const haystack = surveyTextForItem(item);
  if (!haystack) {
    return 0;
  }

  const keywords = buildDeterministicKeywords(query, 24)
    .map(normalizeSurveyMatchText)
    .filter(Boolean);
  const seen = new Set();
  let score = 0;

  for (const keyword of keywords) {
    if (seen.has(keyword) || !haystack.includes(keyword)) {
      continue;
    }

    seen.add(keyword);
    const wordCount = keyword.split(/\s+/).filter(Boolean).length;
    score += wordCount > 1 ? wordCount * 4 : 1;
  }

  return score;
}

export function rankMcpProjectSurvey(query, projectSurvey = []) {
  if (!Array.isArray(projectSurvey) || projectSurvey.length === 0) {
    return [];
  }

  return projectSurvey
    .map(item => ({
      ...item,
      textMatchScore: calculateSurveyTextMatchScore(query, item)
    }))
    .sort((a, b) => (
      (b.textMatchScore || 0) - (a.textMatchScore || 0) ||
      (b.maxSimilarity || 0) - (a.maxSimilarity || 0)
    ));
}

export function normalizeMcpRagContextInput(input = {}) {
  const query = typeof input.query === 'string' && input.query.trim()
    ? input.query.trim()
    : (typeof input.question === 'string' ? input.question.trim() : '');

  if (!query) {
    throw new Error('Search query is required');
  }

  const project = typeof input.project === 'string' ? input.project.trim() : '';
  const projects = normalizeProjects(input);
  const rawMinScore = Number(input.minScore);

  return {
    query,
    project,
    projects,
    strategy: normalizeStrategy(input.strategy, projects),
    mode: normalizeMode(input.mode),
    limit: normalizeLimit(input.limit),
    useReranker: normalizeBoolean(input.useReranker ?? input.rerank, true),
    includeAdjacentChunks: normalizeBoolean(input.includeAdjacentChunks, true),
    smartSelect: normalizeBoolean(input.smartSelect, true),
    contextCharLimit: normalizeContextCharLimit(input.contextCharLimit),
    minScore: Number.isFinite(rawMinScore) ? rawMinScore : undefined,
    keywords: normalizeKeywords(input.keywords),
    surveyChunksPerProject: normalizeBoundedInteger(
      input.surveyChunksPerProject,
      MCP_DEFAULT_SURVEY_CHUNKS_PER_PROJECT,
      MCP_MAX_SURVEY_CHUNKS_PER_PROJECT
    ),
    surveyProjectLimit: normalizeBoundedInteger(
      input.surveyProjectLimit,
      MCP_DEFAULT_SURVEY_PROJECT_LIMIT,
      MCP_MAX_SURVEY_PROJECT_LIMIT
    ),
    deepLimitPerProject: normalizeBoundedInteger(
      input.deepLimitPerProject,
      MCP_DEFAULT_DEEP_LIMIT_PER_PROJECT,
      MCP_MAX_DEEP_LIMIT_PER_PROJECT
    )
  };
}

export function buildMcpToolResult(payload) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}
