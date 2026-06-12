import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMcpToolResult,
  normalizeMcpRagContextInput,
  rankMcpProjectSurvey
} from './tools.js';

test('normalizes MCP RAG context input with internal RAG defaults', () => {
  const input = normalizeMcpRagContextInput({
    question: 'How does indexing work?',
    project: 'docs',
    limit: '500',
    rerank: false,
    includeAdjacentChunks: 'false',
    contextCharLimit: '12000'
  });

  assert.deepEqual(input, {
    query: 'How does indexing work?',
    project: 'docs',
    mode: 'hybrid',
    limit: 100,
    useReranker: false,
    includeAdjacentChunks: false,
    smartSelect: true,
    contextCharLimit: 12000,
    minScore: undefined,
    keywords: undefined,
    strategy: 'deep',
    projects: ['docs'],
    surveyChunksPerProject: 2,
    surveyProjectLimit: 50,
    deepLimitPerProject: 30
  });
});

test('defaults MCP RAG context to project survey when no project is provided', () => {
  const input = normalizeMcpRagContextInput({
    question: 'How do I close acceptance?',
    strategy: 'survey',
    surveyChunksPerProject: '3',
    surveyProjectLimit: '500'
  });

  assert.deepEqual(input, {
    query: 'How do I close acceptance?',
    project: '',
    mode: 'hybrid',
    limit: 30,
    useReranker: true,
    includeAdjacentChunks: true,
    smartSelect: true,
    contextCharLimit: 6000,
    minScore: undefined,
    keywords: undefined,
    strategy: 'survey',
    projects: [],
    surveyChunksPerProject: 3,
    surveyProjectLimit: 50,
    deepLimitPerProject: 30
  });
});

test('normalizes MCP RAG context deep mode for selected projects', () => {
  const input = normalizeMcpRagContextInput({
    query: 'How do I close acceptance?',
    projects: [' user_instruction ', '', 'wiki'],
    deepLimitPerProject: '12'
  });

  assert.deepEqual(input.projects, ['user_instruction', 'wiki']);
  assert.equal(input.project, '');
  assert.equal(input.strategy, 'deep');
  assert.equal(input.limit, 30);
  assert.equal(input.deepLimitPerProject, 12);
});

test('ranks MCP project survey by exact text matches before raw similarity', () => {
  const ranked = rankMcpProjectSurvey('как закрыть приемку', [
    {
      project: 'wdb',
      sourceCount: 2,
      maxSimilarity: 1.1,
      topSources: [
        {
          filename: 'receipt',
          content: 'Purchase order appointment details'
        }
      ]
    },
    {
      project: 'wd',
      sourceCount: 2,
      maxSimilarity: 0.7,
      topSources: [
        {
          filename: 'Документация пользователя LT WMS.pdf',
          content: 'Чтобы закрыть приемку, выполните операцию окончания приемки.'
        }
      ]
    }
  ]);

  assert.equal(ranked[0].project, 'wd');
  assert.ok(ranked[0].textMatchScore > ranked[1].textMatchScore);
});

test('builds MCP tool results with text and structured content', () => {
  const payload = {
    projects: [
      {
        name: 'docs',
        description: 'Internal manuals',
        embedding_model: 'frida'
      }
    ]
  };

  const result = buildMcpToolResult(payload);

  assert.deepEqual(result.structuredContent, payload);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  assert.match(result.content[0].text, /Internal manuals/);
});
