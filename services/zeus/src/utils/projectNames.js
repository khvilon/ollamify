const PROJECT_NAME_MAX_BYTES = 63;
const RESERVED_SCHEMA_NAMES = new Set(['admin', 'public', 'information_schema']);
const PROJECT_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;

export function normalizeProjectName(name) {
  return typeof name === 'string' ? name.trim() : '';
}

export function validateProjectName(name) {
  const normalized = normalizeProjectName(name);

  if (!normalized) {
    return { valid: false, name: normalized, reason: 'Project name is required' };
  }

  if (Buffer.byteLength(normalized, 'utf8') > PROJECT_NAME_MAX_BYTES) {
    return {
      valid: false,
      name: normalized,
      reason: `Project name must be ${PROJECT_NAME_MAX_BYTES} bytes or less`
    };
  }

  const lower = normalized.toLowerCase();
  if (RESERVED_SCHEMA_NAMES.has(lower) || lower.startsWith('pg_')) {
    return { valid: false, name: normalized, reason: 'Project name is reserved' };
  }

  if (!PROJECT_NAME_PATTERN.test(normalized)) {
    return {
      valid: false,
      name: normalized,
      reason: 'Project name may contain only letters, numbers, underscores and hyphens'
    };
  }

  return { valid: true, name: normalized, reason: null };
}

export function assertValidProjectName(name) {
  const result = validateProjectName(name);
  if (!result.valid) {
    const error = new Error(`Invalid project name: ${result.reason}`);
    error.code = 'INVALID_PROJECT_NAME';
    error.details = result.reason;
    throw error;
  }

  return result.name;
}

export function quoteIdentifier(name) {
  const normalized = assertValidProjectName(name);
  return `"${normalized.replace(/"/g, '""')}"`;
}
