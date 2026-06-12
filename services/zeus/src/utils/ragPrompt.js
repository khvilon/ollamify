export const RAG_SYSTEM_PROMPT = `You answer questions strictly from the provided context.
Always answer in the same language as the question.
Preserve exact menu names, button names, statuses, field names, and warnings from the context.
If the question asks for one specific operation, answer that operation and do not add unrelated procedures.
If the context contains several directly relevant ways to perform the requested operation, separate them clearly.
Do not invent steps, prerequisites, UI labels, or explanations that are not supported by the context.
If the context is insufficient, say what is missing instead of guessing.
Use document metadata only when it helps answer the question.`;

export function buildRagContextFromDocs(docs, maxChars = 0) {
  const fragments = [];
  let usedChars = 0;
  const limited = Number.isFinite(maxChars) && maxChars > 0;

  for (const [index, doc] of docs.entries()) {
    const metadataEntries = doc.metadata && typeof doc.metadata === 'object' && !Array.isArray(doc.metadata)
      ? Object.entries(doc.metadata)
      : [];
    const metadataStr = metadataEntries.length > 0
      ? '\nDocument metadata:\n' +
        metadataEntries
          .map(([key, value]) => `- ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
          .join('\n')
      : '';
    const prefix = `${index + 1}. From document ${doc.filename}:${metadataStr}\n`;
    const rawContent = (doc.content || '').trim();
    let content = rawContent;

    if (limited) {
      const remaining = maxChars - usedChars - prefix.length - 2;
      if (remaining < 240) {
        break;
      }

      if (content.length > remaining) {
        content = `${content.slice(0, Math.max(0, remaining - 18)).trim()}\n[truncated]`;
      }
    }

    const fragment = `${prefix}${content}`;
    fragments.push(fragment);
    usedChars += fragment.length + 2;
  }

  return `Relevant fragments:\n\n${fragments.join('\n\n')}`;
}

export function buildRagMessages({ question, context }) {
  return [
    {
      role: 'system',
      content: RAG_SYSTEM_PROMPT
    },
    {
      role: 'user',
      content: `Context:\n${context}\n\nQuestion: ${question}`
    }
  ];
}
