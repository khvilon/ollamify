const MCP_MAX_SEARCH_LIMIT = 100;

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

function normalizeLimit(limit) {
  const numericLimit = Number(limit);
  if (!Number.isFinite(numericLimit)) {
    return 10;
  }

  return Math.min(MCP_MAX_SEARCH_LIMIT, Math.max(1, Math.floor(numericLimit)));
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

export function normalizeMcpSearchInput(input = {}) {
  const query = typeof input.query === 'string' && input.query.trim()
    ? input.query.trim()
    : (typeof input.question === 'string' ? input.question.trim() : '');

  if (!query) {
    throw new Error('Search query is required');
  }

  const project = typeof input.project === 'string' ? input.project.trim() : '';
  const rawMinScore = Number(input.minScore);

  return {
    query,
    project,
    mode: normalizeMode(input.mode),
    limit: normalizeLimit(input.limit),
    useReranker: normalizeBoolean(input.useReranker ?? input.rerank, false),
    includeAdjacentChunks: normalizeBoolean(input.includeAdjacentChunks, false),
    minScore: Number.isFinite(rawMinScore) ? rawMinScore : undefined,
    keywords: normalizeKeywords(input.keywords)
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
