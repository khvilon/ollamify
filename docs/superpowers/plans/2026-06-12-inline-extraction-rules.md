# Inline Extraction Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить chunk-level regex extraction rules в Ollamify upload API и подключить Alfred AI Sync так, чтобы новые документы сразу загружались с правилами извлечения, а старые данные были обновлены одноразовой миграцией без re-embedding.

**Architecture:** Ollamify остается универсальным: он принимает opaque regex rules, применяет их к уже нарезанным чанкам и сохраняет результат в `payload.extracted_metadata`. Alfred AI Sync остается владельцем доменной специфики: он формирует правила и передает их при upload. Одноразовый backfill runner создается только на время миграции, запускается по существующим Qdrant chunk payloads и удаляется до финального коммита.

**Tech Stack:** Node.js ESM, Express, Qdrant REST client, PostgreSQL, встроенный `node:test`, Docker Compose.

---

## File Structure

### Ollamify repo: `D:\dev\livrobina\ollamify`

- Create: `services/zeus/src/utils/extractionRules.js`
  - Валидация `extraction_rules`.
  - Нормализация regex flags.
  - Извлечение значений из текста чанка.
  - Парсинг JSON-полей из JSON и multipart/form-data requests.
- Create: `services/zeus/src/utils/extractionRules.test.js`
  - Unit tests для валидации, дедупликации, лимитов и отсутствия старого поведения.
- Modify: `services/zeus/src/routes/documents.js`
  - Парсить `metadata` безопасно как объект.
  - Парсить и валидировать `extraction_rules`.
  - Передавать нормализованные правила в `processChunks()`.
  - Добавлять `extracted_metadata` в Qdrant payload каждого чанка.
- Modify: `services/zeus/src/db/qdrant.js`
  - Возвращать `extracted_metadata` из Qdrant payload в форматированных результатах.
- Modify: `services/zeus/src/services/retrieval.js`
  - Сохранять `extracted_metadata` при сериализации результатов.
  - Не смешивать `extracted_metadata` с обычным `metadata`.
- Modify: `services/zeus/src/services/retrieval.test.js`
  - Проверить, что `serializeRetrievedDocument()` возвращает `extracted_metadata`.
- Modify: `docs/api/README.md`
  - Описать `extraction_rules`.
- Modify: `docs/api/README.ru.md`
  - Описать `extraction_rules` на русском.
- Temporary create, run, remove before final commit: `services/zeus/src/tmp/one-time-backfill-extracted-metadata.mjs`
  - Одноразовый runner для старых Qdrant chunks.
  - Не должен остаться в финальном diff.

### Alfred AI Sync repo: `D:\dev\ltm\alfred-ai-sync`

- Create: `services/sync/src/config/extraction-rules.js`
  - Company-specific regex rules.
  - Правила являются opaque для Ollamify.
- Create: `services/sync/src/config/extraction-rules.test.js`
  - Unit tests для набора правил и выбора по source type.
- Modify: `services/sync/src/integrations/base-source.js`
  - Расширить `addDocument()` параметром `extractionRules`.
  - Передавать `extraction_rules` в request body только если rules не пустые.
- Modify source files that call `addDocument()`:
  - `services/sync/src/integrations/sources/tracker-source.js`
  - `services/sync/src/integrations/sources/yandex-wiki-source.js`
  - `services/sync/src/integrations/sources/meetings-source.js`
  - `services/sync/src/integrations/sources/gitlab-source.js`
  - `services/sync/src/integrations/sources/helpdesk-source.js`
  - `services/sync/src/integrations/sources/db-tables-source.js`
  - Подключить rules per source.
  - Для источников, где нужен настоящий chunk-level extraction, явно передавать `singleChunk = false`.

---

### Task 1: Ollamify extraction rules utility

**Files:**
- Create: `D:\dev\livrobina\ollamify\services\zeus\src\utils\extractionRules.js`
- Create: `D:\dev\livrobina\ollamify\services\zeus\src\utils\extractionRules.test.js`

- [ ] **Step 1: Write failing tests**

Create `services/zeus/src/utils/extractionRules.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractMetadataFromText,
  parseJsonField,
  validateExtractionRules
} from './extractionRules.js';

test('validates and normalizes regex extraction rules', () => {
  const rules = validateExtractionRules([
    {
      key: 'tracker.keys',
      type: 'regex',
      pattern: '\\bDEV-\\d+\\b',
      flags: 'i'
    }
  ]);

  assert.deepEqual(rules, [
    {
      key: 'tracker.keys',
      type: 'regex',
      pattern: '\\bDEV-\\d+\\b',
      flags: 'gi'
    }
  ]);
});

test('extracts values per chunk and deduplicates in first-seen order', () => {
  const rules = validateExtractionRules([
    {
      key: 'tracker.keys',
      type: 'regex',
      pattern: '\\bDEV-\\d+\\b',
      flags: 'gi'
    }
  ]);

  assert.deepEqual(
    extractMetadataFromText('DEV-123 dev-123 DEV-456 DEV-123', rules),
    {
      'tracker.keys': ['DEV-123', 'dev-123', 'DEV-456']
    }
  );
});

test('returns empty extracted metadata when no rules are provided', () => {
  assert.deepEqual(extractMetadataFromText('DEV-123', []), {});
  assert.deepEqual(validateExtractionRules(undefined), []);
});

test('rejects invalid extraction rules', () => {
  assert.throws(
    () => validateExtractionRules([{ key: 'x', type: 'llm', pattern: 'x' }]),
    /Only regex extraction rules are supported/
  );

  assert.throws(
    () => validateExtractionRules([{ key: 'x', type: 'regex', pattern: '[' }]),
    /Invalid regex pattern/
  );

  assert.throws(
    () => validateExtractionRules([{ key: '', type: 'regex', pattern: 'x' }]),
    /Rule key must be a non-empty string/
  );
});

test('parses JSON fields from object, JSON string, empty input, and rejects arrays for metadata', () => {
  assert.deepEqual(parseJsonField(undefined, 'metadata', {}), {});
  assert.deepEqual(parseJsonField({ a: 1 }, 'metadata', {}), { a: 1 });
  assert.deepEqual(parseJsonField('{"a":1}', 'metadata', {}), { a: 1 });

  assert.throws(
    () => parseJsonField('[1]', 'metadata', {}),
    /metadata must be a JSON object/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `D:\dev\livrobina\ollamify\services\zeus`:

```powershell
node --test src/utils/extractionRules.test.js
```

Expected: FAIL with module not found for `./extractionRules.js`.

- [ ] **Step 3: Implement extraction rules utility**

Create `services/zeus/src/utils/extractionRules.js`:

```js
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
```

- [ ] **Step 4: Run utility tests**

Run from `D:\dev\livrobina\ollamify\services\zeus`:

```powershell
node --test src/utils/extractionRules.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run from `D:\dev\livrobina\ollamify`:

```powershell
git add -- services/zeus/src/utils/extractionRules.js services/zeus/src/utils/extractionRules.test.js
git commit -m "feat: add regex extraction rules utility"
```

---

### Task 2: Ollamify upload pipeline integration

**Files:**
- Modify: `D:\dev\livrobina\ollamify\services\zeus\src\routes\documents.js`
- Test: covered by `D:\dev\livrobina\ollamify\services\zeus\src\utils\extractionRules.test.js` and manual upload smoke test

- [ ] **Step 1: Import extraction helpers**

In `services/zeus/src/routes/documents.js`, add imports near the existing utility imports:

```js
import {
  extractMetadataFromText,
  parseJsonField,
  validateExtractionRules
} from '../utils/extractionRules.js';
```

- [ ] **Step 2: Parse metadata and extraction rules at request start**

Replace:

```js
const { project, content, metadata = {}, name, model, external_id, single_chunk } = req.body;
```

with:

```js
const { project, content, name, model, external_id, single_chunk } = req.body;
let metadata;
let extractionRules;

try {
  metadata = {
    ...parseJsonField(req.body.metadata, 'metadata', {})
  };
  extractionRules = validateExtractionRules(req.body.extraction_rules);
} catch (error) {
  logger.error('Invalid document upload metadata or extraction rules:', error);
  return res.status(400).json({
    error: error.message,
    code: 'INVALID_UPLOAD_METADATA'
  });
}
```

Keep `model` in destructuring only if current code still uses it later. If it is unused, remove it in the same edit.

- [ ] **Step 3: Log rule count without logging patterns**

Extend the existing request log object:

```js
logger.info('Request body:', {
  project: req.body.project,
  hasFile: !!req.file,
  hasContent: !!req.body.content,
  metadata: req.body.metadata,
  extractionRuleCount: Array.isArray(req.body.extraction_rules)
    ? req.body.extraction_rules.length
    : undefined,
  fileSize: req.file ? req.file.size : null
});
```

If `req.body.extraction_rules` can be a JSON string, keep the log count conservative and avoid parsing only for logging:

```js
extractionRulesProvided: req.body.extraction_rules != null
```

- [ ] **Step 4: Pass rules into async chunk processing for updated documents**

Replace:

```js
processChunks(projectName, document.id, chunks, projectEmbeddingModel);
```

with:

```js
processChunks(projectName, document.id, chunks, projectEmbeddingModel, extractionRules);
```

- [ ] **Step 5: Pass rules into async chunk processing for new documents**

Replace both new-document calls:

```js
processChunks(projectName, documentId, chunks, projectEmbeddingModel);
```

with:

```js
processChunks(projectName, documentId, chunks, projectEmbeddingModel, extractionRules);
```

If one of the two calls is part of duplicate processing and causes double processing, keep current behavior unchanged unless tests or manual smoke test expose an existing bug. Do not refactor unrelated async behavior in this task.

- [ ] **Step 6: Update `processChunks()` signature**

Replace:

```js
async function processChunks(project, documentId, chunks, embeddingModel) {
```

with:

```js
async function processChunks(project, documentId, chunks, embeddingModel, extractionRules = []) {
```

- [ ] **Step 7: Add extracted metadata to each Qdrant point**

Inside `processChunks()`, before creating `point`, add:

```js
const extractedMetadata = extractMetadataFromText(chunk, extractionRules);
const hasExtractedMetadata = Object.keys(extractedMetadata).length > 0;
```

Then replace the payload block:

```js
payload: {
  document_id: documentId,
  chunk_index: i,
  content: chunk,
  filename: documentName,
  project: projectName,
  created_at: new Date().toISOString(),
  metadata: documentMetadata
}
```

with:

```js
payload: {
  document_id: documentId,
  chunk_index: i,
  content: chunk,
  filename: documentName,
  project: projectName,
  created_at: new Date().toISOString(),
  metadata: documentMetadata,
  ...(hasExtractedMetadata ? { extracted_metadata: extractedMetadata } : {})
}
```

- [ ] **Step 8: Run Ollamify tests touched by this change**

Run from `D:\dev\livrobina\ollamify\services\zeus`:

```powershell
node --test src/utils/extractionRules.test.js src/services/retrieval.test.js
```

Expected: PASS after Task 3 is also complete for retrieval changes. If running before Task 3, `extractionRules.test.js` must pass and `retrieval.test.js` should keep its previous behavior.

- [ ] **Step 9: Manual upload smoke test**

Start the local stack if it is not running:

```powershell
docker compose up -d zeus vector-db db
```

Send a JSON upload to a test project that already exists:

```powershell
$body = @{
  project = "test"
  name = "extraction-rules-smoke"
  content = "DEV-123 and DEV-456 are mentioned here."
  single_chunk = $false
  metadata = @{ source = "smoke" }
  extraction_rules = @(
    @{
      key = "tracker.keys"
      type = "regex"
      pattern = "\bDEV-\d+\b"
      flags = "g"
    }
  )
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Uri "http://localhost/api/documents" `
  -Method Post `
  -ContentType "application/json" `
  -Headers @{ Authorization = "Bearer $env:OLLAMIFY_KEY" } `
  -Body $body
```

Expected: API returns `status` `created` or `updated`; document reaches `loaded_chunks == total_chunks`.

- [ ] **Step 10: Commit**

Run from `D:\dev\livrobina\ollamify`:

```powershell
git add -- services/zeus/src/routes/documents.js
git commit -m "feat: apply extraction rules during document upload"
```

---

### Task 3: Ollamify retrieval preserves extracted metadata

**Files:**
- Modify: `D:\dev\livrobina\ollamify\services\zeus\src\db\qdrant.js`
- Modify: `D:\dev\livrobina\ollamify\services\zeus\src\services\retrieval.js`
- Modify: `D:\dev\livrobina\ollamify\services\zeus\src\services\retrieval.test.js`

- [ ] **Step 1: Write failing serializer test**

In `services/zeus/src/services/retrieval.test.js`, extend the existing `serializes retrieved chunks with stable source coordinates` input:

```js
extracted_metadata: { 'tracker.keys': ['DEV-123'] }
```

and expected object:

```js
extracted_metadata: { 'tracker.keys': ['DEV-123'] }
```

The full expected object should become:

```js
assert.deepEqual(doc, {
  filename: 'guide.pdf',
  content: 'Step one',
  project: 'warehouse',
  document_id: 42,
  chunk_index: 3,
  similarity: 0.91,
  metadata: { section: 'Inbound' },
  extracted_metadata: { 'tracker.keys': ['DEV-123'] }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `D:\dev\livrobina\ollamify\services\zeus`:

```powershell
node --test src/services/retrieval.test.js
```

Expected: FAIL because `extracted_metadata` is missing from serialized document.

- [ ] **Step 3: Return extracted metadata from Qdrant formatting**

In `services/zeus/src/db/qdrant.js`, inside `_formatSearchResults()`, add the property after `metadata`:

```js
metadata: item.payload.metadata || {},
extracted_metadata: item.payload.extracted_metadata &&
  typeof item.payload.extracted_metadata === 'object' &&
  !Array.isArray(item.payload.extracted_metadata)
  ? item.payload.extracted_metadata
  : {}
```

- [ ] **Step 4: Serialize extracted metadata**

In `services/zeus/src/services/retrieval.js`, update `serializeRetrievedDocument()` to return:

```js
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
      : {},
    extracted_metadata: doc?.extracted_metadata &&
      typeof doc.extracted_metadata === 'object' &&
      !Array.isArray(doc.extracted_metadata)
      ? doc.extracted_metadata
      : {}
  };
}
```

- [ ] **Step 5: Preserve extracted metadata in retrieval merges**

Where `mergeKeywordDocuments()` and hybrid merge build result entries, add `extracted_metadata` alongside `metadata`.

When creating an entry from a doc, use:

```js
extracted_metadata: doc.extracted_metadata &&
  typeof doc.extracted_metadata === 'object' &&
  !Array.isArray(doc.extracted_metadata)
  ? { ...doc.extracted_metadata }
  : {}
```

When returning merged documents, include:

```js
extracted_metadata: entry.extracted_metadata
```

When adjacent chunks are merged back into originals, preserve the original field:

```js
extracted_metadata: doc.extracted_metadata || originalDoc.extracted_metadata || {}
```

- [ ] **Step 6: Run retrieval tests**

Run from `D:\dev\livrobina\ollamify\services\zeus`:

```powershell
node --test src/services/retrieval.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run from `D:\dev\livrobina\ollamify`:

```powershell
git add -- services/zeus/src/db/qdrant.js services/zeus/src/services/retrieval.js services/zeus/src/services/retrieval.test.js
git commit -m "feat: expose extracted metadata in retrieval results"
```

---

### Task 4: Ollamify docs

**Files:**
- Modify: `D:\dev\livrobina\ollamify\docs\api\README.md`
- Modify: `D:\dev\livrobina\ollamify\docs\api\README.ru.md`

- [ ] **Step 1: Update English API docs**

In `docs/api/README.md`, in the document upload parameters section near `metadata` and `single_chunk`, add:

```md
- `extraction_rules` (optional JSON array): caller-provided inline extraction rules applied to each chunk after Ollamify splits the document. Version 1 supports only regex rules.

Example:

```json
[
  {
    "key": "tracker.keys",
    "type": "regex",
    "pattern": "\\bDEV-\\d+\\b",
    "flags": "gi"
  }
]
```

Ollamify treats rule keys as opaque caller-owned metadata keys and stores matches in chunk payload `extracted_metadata`.
```

- [ ] **Step 2: Update Russian API docs**

In `docs/api/README.ru.md`, in the document upload parameters section near `metadata` and `single_chunk`, add:

```md
- `extraction_rules` (опционально JSON array): inline-правила извлечения, которые вызывающий сервис передает вместе с документом. Ollamify применяет их к каждому чанку после нарезки документа. В первой версии поддерживаются только regex-правила.

Пример:

```json
[
  {
    "key": "tracker.keys",
    "type": "regex",
    "pattern": "\\bDEV-\\d+\\b",
    "flags": "gi"
  }
]
```

Ollamify воспринимает ключи правил как opaque metadata вызывающего сервиса и сохраняет найденные значения в chunk payload `extracted_metadata`.
```

- [ ] **Step 3: Commit**

Run from `D:\dev\livrobina\ollamify`:

```powershell
git add -- docs/api/README.md docs/api/README.ru.md
git commit -m "docs: document extraction rules upload option"
```

---

### Task 5: Alfred AI Sync sends inline extraction rules

**Files:**
- Create: `D:\dev\ltm\alfred-ai-sync\services\sync\src\config\extraction-rules.js`
- Create: `D:\dev\ltm\alfred-ai-sync\services\sync\src\config\extraction-rules.test.js`
- Modify: `D:\dev\ltm\alfred-ai-sync\services\sync\src\integrations\base-source.js`
- Modify: `D:\dev\ltm\alfred-ai-sync\services\sync\src\integrations\sources\tracker-source.js`
- Modify: `D:\dev\ltm\alfred-ai-sync\services\sync\src\integrations\sources\yandex-wiki-source.js`
- Modify: `D:\dev\ltm\alfred-ai-sync\services\sync\src\integrations\sources\meetings-source.js`
- Modify: `D:\dev\ltm\alfred-ai-sync\services\sync\src\integrations\sources\gitlab-source.js`
- Modify: `D:\dev\ltm\alfred-ai-sync\services\sync\src\integrations\sources\helpdesk-source.js`
- Modify: `D:\dev\ltm\alfred-ai-sync\services\sync\src\integrations\sources\db-tables-source.js`

- [ ] **Step 1: Write failing tests for Alfred rules config**

Create `services/sync/src/config/extraction-rules.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getExtractionRulesForSource,
  LT_EXTRACTION_RULES
} from './extraction-rules.js';

test('returns company-specific extraction rules for tracker source', () => {
  const rules = getExtractionRulesForSource('tracker');

  assert.ok(rules.length > 0);
  assert.ok(rules.every(rule => rule.type === 'regex'));
  assert.ok(rules.some(rule => rule.key === 'tracker.keys'));
});

test('returns a defensive copy of extraction rules', () => {
  const first = getExtractionRulesForSource('tracker');
  first.push({ key: 'mutated', type: 'regex', pattern: 'x' });

  const second = getExtractionRulesForSource('tracker');
  assert.equal(second.some(rule => rule.key === 'mutated'), false);
});

test('all configured rules have opaque keys and regex patterns', () => {
  for (const [source, rules] of Object.entries(LT_EXTRACTION_RULES)) {
    assert.ok(Array.isArray(rules), `${source} rules must be an array`);
    for (const rule of rules) {
      assert.equal(typeof rule.key, 'string');
      assert.ok(rule.key.length > 0);
      assert.equal(rule.type, 'regex');
      assert.equal(typeof rule.pattern, 'string');
      assert.ok(rule.pattern.length > 0);
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `D:\dev\ltm\alfred-ai-sync`:

```powershell
node --test services/sync/src/config/extraction-rules.test.js
```

Expected: FAIL with module not found for `./extraction-rules.js`.

- [ ] **Step 3: Create company-specific rules config**

Create `services/sync/src/config/extraction-rules.js`:

```js
const COMMON_RULES = [
  {
    key: 'tracker.keys',
    type: 'regex',
    pattern: '\\b[A-ZА-Я]{2,10}-\\d+\\b',
    flags: 'g'
  },
  {
    key: 'infra.ipv4',
    type: 'regex',
    pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
    flags: 'g'
  },
  {
    key: 'infra.hostnames',
    type: 'regex',
    pattern: '\\b[a-zA-Z0-9][a-zA-Z0-9-]{1,62}(?:\\.[a-zA-Z0-9][a-zA-Z0-9-]{1,62})*\\b',
    flags: 'g'
  }
];

export const LT_EXTRACTION_RULES = {
  tracker: COMMON_RULES,
  yandex_wiki: COMMON_RULES,
  meetings: COMMON_RULES,
  gitlab: [
    ...COMMON_RULES,
    {
      key: 'git.repo.paths',
      type: 'regex',
      pattern: '\\b[\\w.-]+/[\\w./-]+\\b',
      flags: 'g'
    }
  ],
  helpdesk: COMMON_RULES,
  db_tables: [
    ...COMMON_RULES,
    {
      key: 'db.table.names',
      type: 'regex',
      pattern: '\\b[a-zA-Z_][a-zA-Z0-9_]*\\.[a-zA-Z_][a-zA-Z0-9_]*\\b',
      flags: 'g'
    }
  ]
};

export function getExtractionRulesForSource(sourceType) {
  const rules = LT_EXTRACTION_RULES[sourceType] || [];
  return rules.map(rule => ({ ...rule }));
}
```

These keys are company-owned opaque strings. Ollamify must not interpret them.

- [ ] **Step 4: Run config tests**

Run from `D:\dev\ltm\alfred-ai-sync`:

```powershell
node --test services/sync/src/config/extraction-rules.test.js
```

Expected: PASS.

- [ ] **Step 5: Extend `BaseSource.addDocument()` signature**

In `services/sync/src/integrations/base-source.js`, replace the signature:

```js
async addDocument(name, content, project, externalId, metadata = {}, singleChunk = true) {
```

with:

```js
async addDocument(name, content, project, externalId, metadata = {}, singleChunk = true, extractionRules = []) {
```

- [ ] **Step 6: Include extraction rules in upload request body**

In `BaseSource.addDocument()`, after `requestBody` is created, add:

```js
if (Array.isArray(extractionRules) && extractionRules.length > 0) {
  requestBody.extraction_rules = extractionRules;
}
```

Do not send `extraction_rules` when the array is empty, so old Ollamify deployments remain compatible during staged rollout.

- [ ] **Step 7: Pass rules from tracker source**

In `services/sync/src/integrations/sources/tracker-source.js`, add import:

```js
import { getExtractionRulesForSource } from '../../config/extraction-rules.js';
```

Before the loop or inside `checkForNewIssues()`, define:

```js
const extractionRules = getExtractionRulesForSource('tracker');
```

Replace:

```js
await this.addDocument(subject, doc, this.projectName, issues[i].issue_id, metadata);
```

with:

```js
await this.addDocument(subject, doc, this.projectName, issues[i].issue_id, metadata, false, extractionRules);
```

- [ ] **Step 8: Pass rules from other source classes**

For each source file, import `getExtractionRulesForSource` from `../../config/extraction-rules.js` and pass source-specific rules into `addDocument()`.

Use this mapping:

```js
const extractionRules = getExtractionRulesForSource('yandex_wiki');
const extractionRules = getExtractionRulesForSource('meetings');
const extractionRules = getExtractionRulesForSource('gitlab');
const extractionRules = getExtractionRulesForSource('helpdesk');
const extractionRules = getExtractionRulesForSource('db_tables');
```

When existing calls already pass `singleChunk`, keep that value and add rules as the next argument:

```js
await this.addDocument(name, content, this.projectName, externalId, metadata, false, extractionRules);
```

When an existing call does not pass `singleChunk`, choose:

```js
await this.addDocument(name, content, this.projectName, externalId, metadata, false, extractionRules);
```

for long text sources where chunk-level extraction matters. Use:

```js
await this.addDocument(name, content, this.projectName, externalId, metadata, true, extractionRules);
```

only for intentionally short summary documents that should remain one chunk.

- [ ] **Step 9: Run Alfred tests**

Run from `D:\dev\ltm\alfred-ai-sync`:

```powershell
node --test services/sync/src/config/extraction-rules.test.js
```

Expected: PASS.

- [ ] **Step 10: Commit Alfred changes**

Run from `D:\dev\ltm\alfred-ai-sync`:

```powershell
git add -- services/sync/src/config/extraction-rules.js services/sync/src/config/extraction-rules.test.js services/sync/src/integrations/base-source.js services/sync/src/integrations/sources
git commit -m "feat: send extraction rules to ollamify"
```

---

### Task 6: One-time backfill runner, execute, then remove

**Files:**
- Temporary create: `D:\dev\livrobina\ollamify\services\zeus\src\tmp\one-time-backfill-extracted-metadata.mjs`
- Temporary create: `D:\dev\livrobina\ollamify\services\zeus\src\tmp\lt-extraction-rules.json`
- Remove before final commit: both temporary files

- [ ] **Step 1: Create temporary directory and rules file**

Create `services/zeus/src/tmp/lt-extraction-rules.json` using the same rule content as Alfred's `LT_EXTRACTION_RULES` for the target project.

Run from `D:\dev\livrobina\ollamify`:

```powershell
New-Item -ItemType Directory -Force -Path services\zeus\src\tmp | Out-Null
```

Example:

```json
[
  {
    "key": "tracker.keys",
    "type": "regex",
    "pattern": "\\b[A-ZА-Я]{2,10}-\\d+\\b",
    "flags": "g"
  },
  {
    "key": "infra.ipv4",
    "type": "regex",
    "pattern": "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b",
    "flags": "g"
  },
  {
    "key": "infra.hostnames",
    "type": "regex",
    "pattern": "\\b[a-zA-Z0-9][a-zA-Z0-9-]{1,62}(?:\\.[a-zA-Z0-9][a-zA-Z0-9-]{1,62})*\\b",
    "flags": "g"
  }
]
```

- [ ] **Step 2: Create temporary backfill runner**

Create `services/zeus/src/tmp/one-time-backfill-extracted-metadata.mjs`:

```js
import fs from 'node:fs/promises';
import { QdrantClient } from '@qdrant/js-client-rest';
import {
  extractMetadataFromText,
  validateExtractionRules
} from '../utils/extractionRules.js';

function readArg(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const arg = process.argv.find(item => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

const project = readArg('project');
const rulesFile = readArg('rules-file');
const qdrantUrl = readArg('qdrant-url', process.env.QDRANT_URL || 'http://vector-db:6333');
const dryRun = process.argv.includes('--dry-run');
const batchSize = Number(readArg('batch-size', '100'));

if (!project) {
  throw new Error('Missing --project=<qdrant collection/project>');
}

if (!rulesFile) {
  throw new Error('Missing --rules-file=<path>');
}

const rulesJson = JSON.parse(await fs.readFile(rulesFile, 'utf8'));
const rules = validateExtractionRules(rulesJson);
const client = new QdrantClient({ url: qdrantUrl, checkCompatibility: false });

let offset = undefined;
let scanned = 0;
let patched = 0;

do {
  const result = await client.scroll(project, {
    limit: batchSize,
    offset,
    with_payload: true,
    with_vector: false
  });

  const points = Array.isArray(result.points) ? result.points : [];

  for (const point of points) {
    scanned += 1;
    const content = point.payload?.content || '';
    const extracted = extractMetadataFromText(content, rules);

    if (Object.keys(extracted).length === 0) {
      continue;
    }

    patched += 1;

    if (!dryRun) {
      await client.setPayload(project, {
        points: [point.id],
        payload: {
          extracted_metadata: extracted
        },
        wait: true
      });
    }
  }

  offset = result.next_page_offset;
  console.log(`scanned=${scanned} patched=${patched} dryRun=${dryRun}`);
} while (offset);

console.log(`done project=${project} scanned=${scanned} patched=${patched} dryRun=${dryRun}`);
```

- [ ] **Step 3: Stop Alfred AI Sync before backfill**

Run on the deployed server in `D:\dev\ltm\alfred-ai-sync` or the equivalent server path:

```powershell
docker compose stop sync
```

Expected: service `sync` is stopped.

- [ ] **Step 4: Dry-run backfill**

Run inside the Ollamify `zeus` container so `http://vector-db:6333` resolves:

```powershell
docker compose exec zeus node src/tmp/one-time-backfill-extracted-metadata.mjs --project=tr --rules-file=src/tmp/lt-extraction-rules.json --dry-run
```

Expected: logs show `scanned=<n> patched=<m> dryRun=true` and no errors.

- [ ] **Step 5: Execute backfill**

Run:

```powershell
docker compose exec zeus node src/tmp/one-time-backfill-extracted-metadata.mjs --project=tr --rules-file=src/tmp/lt-extraction-rules.json
```

Repeat for each target Ollamify project/collection that Alfred currently writes to:

```powershell
docker compose exec zeus node src/tmp/one-time-backfill-extracted-metadata.mjs --project=ts --rules-file=src/tmp/lt-extraction-rules.json
docker compose exec zeus node src/tmp/one-time-backfill-extracted-metadata.mjs --project=wd --rules-file=src/tmp/lt-extraction-rules.json
```

Expected: logs show patched counts and no errors.

- [ ] **Step 6: Verify a Qdrant sample**

Run:

```powershell
docker compose exec zeus node -e "import { QdrantClient } from '@qdrant/js-client-rest'; const c = new QdrantClient({ url: 'http://vector-db:6333', checkCompatibility: false }); const r = await c.scroll('tr', { limit: 5, with_payload: true, with_vector: false }); console.log(JSON.stringify(r.points.map(p => ({ id: p.id, extracted_metadata: p.payload.extracted_metadata })), null, 2));"
```

Expected: at least one returned point has `extracted_metadata` when the sample content contains matches.

- [ ] **Step 7: Remove temporary runner and rules file**

Run from `D:\dev\livrobina\ollamify`:

```powershell
Remove-Item -LiteralPath services\zeus\src\tmp\one-time-backfill-extracted-metadata.mjs
Remove-Item -LiteralPath services\zeus\src\tmp\lt-extraction-rules.json
Remove-Item -LiteralPath services\zeus\src\tmp -ErrorAction SilentlyContinue
```

Expected: both files are gone and do not appear in final `git status`.

- [ ] **Step 8: Start Alfred AI Sync**

Run on the deployed server in `D:\dev\ltm\alfred-ai-sync` or the equivalent server path:

```powershell
docker compose up -d sync
docker compose logs -f sync
```

Expected: `sync` starts and new upload requests include `extraction_rules`.

---

### Task 7: Final verification

**Files:**
- No new files.
- Verify both repositories.

- [ ] **Step 1: Run Ollamify tests**

Run from `D:\dev\livrobina\ollamify\services\zeus`:

```powershell
node --test src/utils/extractionRules.test.js src/services/retrieval.test.js
```

Expected: PASS.

- [ ] **Step 2: Run Alfred tests**

Run from `D:\dev\ltm\alfred-ai-sync`:

```powershell
node --test services/sync/src/config/extraction-rules.test.js
```

Expected: PASS.

- [ ] **Step 3: Confirm temporary files are removed**

Run from `D:\dev\livrobina\ollamify`:

```powershell
git status --short
```

Expected: no `services/zeus/src/tmp/one-time-backfill-extracted-metadata.mjs` and no `services/zeus/src/tmp/lt-extraction-rules.json`.

- [ ] **Step 4: Confirm Ollamify final diff**

Run from `D:\dev\livrobina\ollamify`:

```powershell
git status --short
git log --oneline -5
```

Expected: only intentional committed changes remain.

- [ ] **Step 5: Confirm Alfred final diff**

Run from `D:\dev\ltm\alfred-ai-sync`:

```powershell
git status --short
git log --oneline -5
```

Expected: only intentional committed changes remain.
