const MAX_RULES = 50;
const MAX_PATTERN_LENGTH = 500;
const MAX_KEY_LENGTH = 160;
const MAX_MATCHES_PER_RULE_PER_CHUNK = 100;
const MAX_EXTRACTED_VALUE_LENGTH = 500;
const ALLOWED_FLAGS = new Set(['g', 'i', 'm', 's', 'u', 'y']);

function normalizeFlags(flags = '') {
  if (typeof flags !== 'string') {
    throw new Error('Regex flags must be a string');
  }

  const seen = new Set();
  for (const flag of flags) {
    if (!ALLOWED_FLAGS.has(flag)) {
      throw new Error(`Unsupported regex flag: ${flag}`);
    }
    if (seen.has(flag)) {
      throw new Error(`Duplicate regex flag: ${flag}`);
    }
    seen.add(flag);
  }

  seen.add('g');
  return Array.from(seen).sort().join('');
}

export function parseJsonField(value, fieldName, defaultValue) {
  if (value == null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (error) {
      throw new Error(`${fieldName} must be valid JSON: ${error.message}`);
    }
  }

  if (fieldName === 'metadata') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('metadata must be a JSON object');
    }
  }

  if (fieldName === 'extraction_rules' && !Array.isArray(value)) {
    throw new Error('extraction_rules must be a JSON array');
  }

  return value;
}

export function validateExtractionRules(input) {
  const rules = parseJsonField(input, 'extraction_rules', []);

  if (rules.length > MAX_RULES) {
    throw new Error(`Too many extraction rules: maximum is ${MAX_RULES}`);
  }

  return rules.map((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      throw new Error(`Extraction rule at index ${index} must be an object`);
    }

    const { key, type, pattern, flags = '' } = rule;

    if (typeof key !== 'string' || key.trim() === '') {
      throw new Error(`Rule key must be a non-empty string at index ${index}`);
    }

    if (key.length > MAX_KEY_LENGTH) {
      throw new Error(`Rule key is too long at index ${index}`);
    }

    if (type !== 'regex') {
      throw new Error('Only regex extraction rules are supported');
    }

    if (typeof pattern !== 'string' || pattern.length === 0) {
      throw new Error(`Regex pattern must be a non-empty string at index ${index}`);
    }

    if (pattern.length > MAX_PATTERN_LENGTH) {
      throw new Error(`Regex pattern is too long at index ${index}`);
    }

    const normalizedFlags = normalizeFlags(flags);
    try {
      new RegExp(pattern, normalizedFlags);
    } catch (error) {
      throw new Error(`Invalid regex pattern at index ${index}: ${error.message}`);
    }

    return {
      key,
      type: 'regex',
      pattern,
      flags: normalizedFlags
    };
  });
}

export function extractMetadataFromText(text, rules) {
  if (!text || !Array.isArray(rules) || rules.length === 0) {
    return {};
  }

  const extracted = {};

  for (const rule of rules) {
    const regex = new RegExp(rule.pattern, rule.flags);
    const values = [];
    const seen = new Set();
    let match;

    while ((match = regex.exec(text)) !== null) {
      const value = String(match[0] || '').trim();

      if (value && value.length <= MAX_EXTRACTED_VALUE_LENGTH && !seen.has(value)) {
        seen.add(value);
        values.push(value);
      }

      if (values.length >= MAX_MATCHES_PER_RULE_PER_CHUNK) {
        break;
      }

      if (match[0] === '') {
        regex.lastIndex += 1;
      }
    }

    if (values.length > 0) {
      extracted[rule.key] = values;
    }
  }

  return extracted;
}
