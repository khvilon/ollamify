import { stripThinkingContent } from './ragText.js';

const DEFAULT_MAX_KEYWORD_LENGTH = 100;
const DEFAULT_MAX_KEYWORD_WORDS = 6;

const SEARCH_STOP_WORDS = new Set([
  'а', 'без', 'бы', 'в', 'во', 'вот', 'для', 'до', 'если', 'же', 'за', 'зачем',
  'и', 'из', 'или', 'именно', 'как', 'какая', 'какие', 'какой', 'куда', 'ли',
  'мне', 'можно', 'на', 'над', 'надо', 'не', 'нужно', 'о', 'об', 'от', 'по',
  'под', 'почему', 'при', 'про', 'с', 'со', 'то', 'у', 'через', 'что', 'чтобы',
  'это', 'этого', 'этом', 'этот',
  'a', 'an', 'and', 'are', 'as', 'at', 'by', 'for', 'from', 'how', 'if', 'in',
  'is', 'of', 'on', 'or', 'the', 'to', 'what', 'when', 'where', 'why', 'with'
]);

function canonicalizeText(text) {
  return stripThinkingContent(String(text || ''))
    .normalize('NFKC')
    .replace(/[ёЁ]/g, 'е')
    .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isContentToken(token) {
  if (!token || SEARCH_STOP_WORDS.has(token)) {
    return false;
  }

  if (!/[\p{L}\p{N}]/u.test(token)) {
    return false;
  }

  return token.length >= 2;
}

export function extractSearchTokens(query) {
  const normalized = canonicalizeText(query);
  if (!normalized) {
    return [];
  }

  const seen = new Set();
  const tokens = [];

  for (const token of normalized.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) || []) {
    if (!isContentToken(token) || seen.has(token)) {
      continue;
    }

    seen.add(token);
    tokens.push(token);
  }

  return tokens;
}

function addRussianMorphologyVariants(token, candidates) {
  if (!/^[а-я]+$/u.test(token) || token.length < 5) {
    return;
  }

  if (token.endsWith('ть')) {
    const base = token.slice(0, -2);
    if (base.length >= 3) {
      if (token.endsWith('дать') || token.endsWith('овать')) {
        candidates.push(`${base}ние`, `${base}ния`);
      } else {
        candidates.push(`${base}тие`, `${base}тия`);
      }
    }
  }

  if (token.endsWith('ку')) {
    const base = token.slice(0, -2);
    candidates.push(`${base}ка`, `${base}ки`, `${base}ке`);
  } else if (token.endsWith('ки')) {
    const base = token.slice(0, -2);
    candidates.push(`${base}ка`, `${base}ку`, `${base}ке`);
  } else if (token.endsWith('кой')) {
    const base = token.slice(0, -3);
    candidates.push(`${base}ка`, `${base}ки`, `${base}ку`);
  }
}

export function normalizeKeywordCandidates(candidates, maxKeywords, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const maxLength = Math.max(1, Number(options.maxLength) || DEFAULT_MAX_KEYWORD_LENGTH);
  const maxWords = Math.max(1, Number(options.maxWords) || DEFAULT_MAX_KEYWORD_WORDS);
  const limit = Math.max(1, Number(maxKeywords) || candidates.length);

  const normalizedKeywords = [];
  const seen = new Set();

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const trimmed = stripThinkingContent(candidate)
      .normalize('NFKC')
      .trim()
      .replace(/^['"`«»]+|['"`«»]+$/g, '')
      .replace(/\s+/g, ' ');

    if (!trimmed || trimmed.length > maxLength) {
      continue;
    }

    if (/^</.test(trimmed) || trimmed.includes('>')) {
      continue;
    }

    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > maxWords) {
      continue;
    }

    if (!/[\p{L}\p{N}]/u.test(trimmed)) {
      continue;
    }

    const canonical = canonicalizeText(trimmed);
    if (!canonical || seen.has(canonical)) {
      continue;
    }

    seen.add(canonical);
    normalizedKeywords.push(trimmed);

    if (normalizedKeywords.length >= limit) {
      break;
    }
  }

  return normalizedKeywords;
}

export function buildDeterministicSearchQuery(query) {
  const tokens = extractSearchTokens(query);
  return tokens.length > 0 ? tokens.join(' ') : String(query || '').trim();
}

export function buildDeterministicKeywords(query, maxKeywords = 16) {
  const tokens = extractSearchTokens(query);
  if (tokens.length === 0) {
    return [];
  }

  const candidates = [];

  candidates.push(...tokens);

  for (let n = 2; n <= 3; n += 1) {
    for (let index = 0; index <= tokens.length - n; index += 1) {
      candidates.push(tokens.slice(index, index + n).join(' '));
    }
  }

  if (tokens.length > 1) {
    candidates.push(tokens.join(' '));
  }

  for (const token of tokens) {
    addRussianMorphologyVariants(token, candidates);
  }

  return normalizeKeywordCandidates(candidates, Math.max(maxKeywords, tokens.length), {
    maxLength: DEFAULT_MAX_KEYWORD_LENGTH,
    maxWords: DEFAULT_MAX_KEYWORD_WORDS
  });
}
