const CLOSED_THINKING_BLOCK_REGEX = /<(?:think|thinking|\u0430\u043d\u0430\u043b\u0438\u0437|\u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u0435)[^>]*>[\s\S]*?<\/(?:think|thinking|\u0430\u043d\u0430\u043b\u0438\u0437|\u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u0435)[^>]*>/gi;
const UNFINISHED_THINKING_BLOCK_REGEX = /<(?:think|thinking|\u0430\u043d\u0430\u043b\u0438\u0437|\u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u0435)[^>]*>[\s\S]*$/i;

export function stripThinkingContent(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(CLOSED_THINKING_BLOCK_REGEX, '')
    .replace(UNFINISHED_THINKING_BLOCK_REGEX, '')
    .trim();
}
