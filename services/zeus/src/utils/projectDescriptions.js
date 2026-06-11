const PROJECT_DESCRIPTION_MAX_CHARS = 4000;

export function normalizeProjectDescription(description) {
  if (description === undefined || description === null) {
    return '';
  }

  return String(description).trim();
}

export function validateProjectDescription(description) {
  const normalized = normalizeProjectDescription(description);

  if (normalized.length > PROJECT_DESCRIPTION_MAX_CHARS) {
    return {
      valid: false,
      description: normalized,
      reason: `Project description must be ${PROJECT_DESCRIPTION_MAX_CHARS} characters or less`
    };
  }

  return {
    valid: true,
    description: normalized,
    reason: null
  };
}

export function assertValidProjectDescription(description) {
  const result = validateProjectDescription(description);
  if (!result.valid) {
    const error = new Error(`Invalid project description: ${result.reason}`);
    error.code = 'INVALID_PROJECT_DESCRIPTION';
    error.details = result.reason;
    throw error;
  }

  return result.description;
}
