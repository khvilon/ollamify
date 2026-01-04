# API reference (external)

**Language:** **English** | [Русский](reference.ru.md)

This is a human‑friendly reference that mirrors the **external** Swagger (`/api/docs`) and is useful even if you haven’t installed Ollamify yet.

For a full machine‑readable snapshot:
- `docs/api/swagger/swagger.json`

## Base URL

When running locally:

- `BASE_URL=http://localhost/api`

All paths below are shown **without** the `/api` prefix (as in OpenAPI). Example:

- Path: `/documents`
- Full URL: `http://localhost/api/documents`

## Authentication

Most endpoints require:

```
Authorization: Bearer <JWT or API_KEY>
```

See: [`authentication.md`](authentication.md)

---

## Choosing models (Ollama vs OpenRouter)

You select the provider **per request** via the `model` field.

### Local (Ollama)

- Use a normal model name, e.g. `llama3.1:8b`
- The model must be available in Ollama (use the UI → **Models** to install/pull)

### Proxied (OpenRouter)

- Prefix with `openrouter/`, e.g. `openrouter/anthropic/claude-3.5-sonnet`
- Requires `OPENROUTER_API_KEY` in `.env`

---

## Documents

### GET `/documents`

List documents (supports pagination + filtering).

**Query parameters**
- `project` (optional): project name. If omitted, aggregates across projects.
- `page` (default `1`)
- `limit` (default `10`)
- `order_by` (`created_at|name|total_chunks|loaded_chunks`, default `created_at`)
- `order` (`ASC|DESC`, default `DESC`)
- `search` (optional): case-insensitive search by name

**Example**

```bash
curl -sS "$BASE_URL/documents?project=my-docs&page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

### POST `/documents`

Upload a document as:
- a file (`multipart/form-data`), or
- plain text (`application/json`)

Indexing happens asynchronously — you can track progress via `loaded_chunks / total_chunks` in the document list.

**Multipart fields**
- `file` (PDF/DOCX/TXT)
- `project` (required)
- `name` (optional)
- `metadata` (optional JSON)
- `external_id` (optional): idempotency key (if same `external_id` + same content → returns `status=exists`)
- `single_chunk` (optional boolean): do not split into chunks

**Example (file)**

```bash
curl -sS "$BASE_URL/documents" \
  -H "Authorization: Bearer $TOKEN" \
  -F "project=my-docs" \
  -F "file=@./my.pdf"
```

**Example (text)**

```bash
curl -sS "$BASE_URL/documents" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"project":"my-docs","name":"notes","content":"Hello world"}'
```

### GET `/documents/projects`

List projects with their embedding models.

```bash
curl -sS "$BASE_URL/documents/projects" \
  -H "Authorization: Bearer $TOKEN"
```

### GET `/documents/{id}`

Get document metadata by id (requires `project` query).

```bash
curl -sS "$BASE_URL/documents/123?project=my-docs" \
  -H "Authorization: Bearer $TOKEN"
```

### DELETE `/documents/{id}`

Delete document (requires `project` query).

```bash
curl -sS -X DELETE "$BASE_URL/documents/123?project=my-docs" \
  -H "Authorization: Bearer $TOKEN"
```

---

## AI & RAG

### POST `/ai/rag`

RAG answer: retrieve relevant chunks and generate an answer with an LLM.

**Body (minimal)**
- `question` (required)
- `project` (required)
- `model` (required): Ollama model (e.g. `llama3.1:8b`) or OpenRouter model via prefix `openrouter/...`

**Body (useful options)**
- `useReranker` (default `true`)
- `limit` (default `30`)
- `think` (default `true`)
- `useHybridSearch` (default `true`)

**Example**

```bash
curl -sS "$BASE_URL/ai/rag" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Что такое машинное обучение?",
    "project": "my-docs",
    "model": "llama3.1:8b",
    "useReranker": true,
    "useHybridSearch": true,
    "limit": 20,
    "think": true
  }'
```

### POST `/ai/rag/chunks`

Retrieve relevant chunks only (no answer generation).

```bash
curl -sS "$BASE_URL/ai/rag/chunks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Какие метрики качества упоминаются?",
    "project": "my-docs",
    "limit": 10,
    "useHybridSearch": true
  }'
```

---

## AI & Embeddings

### POST `/ai/embed`

OpenAI‑style embeddings endpoint (backed by Ollama embeddings).

```bash
curl -sS "$BASE_URL/ai/embed" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nomic-embed-text",
    "input": ["first text", "second text"],
    "encoding_format": "float"
  }'
```

---

## OpenAI Compatible

### POST `/v1/chat/completions`

OpenAI Chat Completions compatible endpoint.

Full URL (local):
- `http://localhost/api/v1/chat/completions`

**Important**
- If `model` starts with `openrouter/`, Ollamify routes the request to OpenRouter.
- Streaming (`stream=true`) is supported for **Ollama** models and not supported for **OpenRouter** models.

**Example**

```bash
curl -sS "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.1:8b",
    "messages": [
      {"role":"system","content":"You are a helpful assistant"},
      {"role":"user","content":"Explain RAG in one paragraph"}
    ],
    "temperature": 0.7,
    "max_tokens": 300,
    "stream": false
  }'
```

---

## TTS (Silero)

### GET `/tts/voices`

```bash
curl -sS "$BASE_URL/tts/voices" \
  -H "Authorization: Bearer $TOKEN"
```

### POST `/tts/synthesize`

Returns JSON with base64‑encoded WAV.

```bash
curl -sS "$BASE_URL/tts/synthesize" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text":"Привет!",
    "voice":"aidar",
    "speed":1.0,
    "sample_rate":24000,
    "format":"wav",
    "language":"ru"
  }'
```

### POST `/tts/synthesize/stream`

Returns binary WAV (use `-o`).

```bash
curl -sS "$BASE_URL/tts/synthesize/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Привет!","voice":"baya","sample_rate":24000}' \
  -o speech.wav
```

### GET `/tts/health`

```bash
curl -sS "$BASE_URL/tts/health" \
  -H "Authorization: Bearer $TOKEN"
```

---

## STT (Whisper)

### GET `/stt/models`

```bash
curl -sS "$BASE_URL/stt/models" \
  -H "Authorization: Bearer $TOKEN"
```

### POST `/stt/model/load`

```bash
curl -sS "$BASE_URL/stt/model/load" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model_name":"base"}'
```

### POST `/stt/transcribe`

```bash
curl -sS "$BASE_URL/stt/transcribe" \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@./sample.wav" \
  -F "language=ru" \
  -F "task=transcribe"
```

### GET `/stt/health`

```bash
curl -sS "$BASE_URL/stt/health" \
  -H "Authorization: Bearer $TOKEN"
```

