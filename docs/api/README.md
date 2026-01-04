# API documentation

**Language:** **English** | [Русский](README.ru.md)

This page is meant to be useful **before you install anything**: it explains authentication, model routing (Ollama vs OpenRouter), lists all external endpoints, provides copy‑paste examples and an offline Swagger snapshot.

## Base URL

When running locally via the gateway (recommended):

- `BASE_URL=http://localhost/api`

All endpoints below are shown **without** the `/api` prefix (as in OpenAPI). Example:

- Path: `/documents`
- Full URL: `http://localhost/api/documents`

## Swagger (live, when the stack is running)

- **Swagger UI**: `http://localhost/api/docs`
- **OpenAPI JSON**: `http://localhost/api/docs/swagger.json`

## Authentication

All protected endpoints require:

```
Authorization: Bearer <TOKEN>
```

Where `<TOKEN>` is either:

- a **JWT** (web UI login), or
- an **API key** (for external integrations)

### JWT flow (web UI)

1) Login:

- `POST /auth/login`
- body:

```json
{ "email": "admin@example.com", "password": "admin" }
```

- response:

```json
{ "token": "..." }
```

2) Use it:

```
Authorization: Bearer <token>
```

### API key flow (external integrations)

API keys are created in the web UI:

- Users → API keys → Create

Then use the API key exactly like a token:

```
Authorization: Bearer <api_key>
```

## Choosing models (Ollama vs OpenRouter)

You select the provider **per request** via the `model` field.

### Local (Ollama)

- Use a normal model name, e.g. `llama3.1:8b`
- The model must be available in Ollama (use the UI → **Models** to install/pull)

### Proxied (OpenRouter)

- Prefix with `openrouter/`, e.g. `openrouter/anthropic/claude-3.5-sonnet`
- Requires `OPENROUTER_API_KEY` in `.env`

## Quick start (variables for examples)

```bash
BASE_URL="http://localhost/api"
TOKEN="YOUR_JWT_OR_API_KEY"
```

---

## API reference (external)

This section mirrors the **external** Swagger and is intended for integrations.

### Documents

#### GET `/documents`

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

#### POST `/documents`

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

#### GET `/documents/projects`

List projects with their embedding models.

```bash
curl -sS "$BASE_URL/documents/projects" \
  -H "Authorization: Bearer $TOKEN"
```

#### GET `/documents/{id}`

Get document metadata by id (requires `project` query).

```bash
curl -sS "$BASE_URL/documents/123?project=my-docs" \
  -H "Authorization: Bearer $TOKEN"
```

#### DELETE `/documents/{id}`

Delete document (requires `project` query).

```bash
curl -sS -X DELETE "$BASE_URL/documents/123?project=my-docs" \
  -H "Authorization: Bearer $TOKEN"
```

---

### AI & RAG

#### POST `/ai/rag`

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

#### POST `/ai/rag/chunks`

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

### AI & Embeddings

#### POST `/ai/embed`

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

### OpenAI Compatible

#### POST `/v1/chat/completions`

OpenAI Chat Completions compatible endpoint.

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

### TTS (Silero)

#### GET `/tts/voices`

```bash
curl -sS "$BASE_URL/tts/voices" \
  -H "Authorization: Bearer $TOKEN"
```

#### POST `/tts/synthesize`

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

#### POST `/tts/synthesize/stream`

Returns binary WAV (use `-o`).

```bash
curl -sS "$BASE_URL/tts/synthesize/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Привет!","voice":"baya","sample_rate":24000}' \
  -o speech.wav
```

#### GET `/tts/health`

```bash
curl -sS "$BASE_URL/tts/health" \
  -H "Authorization: Bearer $TOKEN"
```

---

### STT (Whisper)

#### GET `/stt/models`

```bash
curl -sS "$BASE_URL/stt/models" \
  -H "Authorization: Bearer $TOKEN"
```

#### POST `/stt/model/load`

```bash
curl -sS "$BASE_URL/stt/model/load" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model_name":"base"}'
```

#### POST `/stt/transcribe`

```bash
curl -sS "$BASE_URL/stt/transcribe" \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@./sample.wav" \
  -F "language=ru" \
  -F "task=transcribe"
```

#### GET `/stt/health`

```bash
curl -sS "$BASE_URL/stt/health" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Code examples (JS/Python)

### Login (JWT)

```bash
curl -sS "http://localhost/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin"}'
```

### JavaScript (fetch)

```javascript
const BASE_URL = "http://localhost/api";
const token = "YOUR_JWT_OR_API_KEY";

const res = await fetch(`${BASE_URL}/ai/rag`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    question: "What is in the docs?",
    project: "my-docs",
    model: "llama3.1:8b",
    useReranker: true,
    useHybridSearch: true,
  }),
});

console.log(await res.json());
```

### Python (requests)

```python
import requests

BASE_URL = "http://localhost/api"
token = "YOUR_JWT_OR_API_KEY"

resp = requests.post(
    f"{BASE_URL}/ai/rag",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "question": "What is in the docs?",
        "project": "my-docs",
        "model": "llama3.1:8b",
        "useReranker": True,
        "useHybridSearch": True,
    },
    timeout=300,
)

resp.raise_for_status()
print(resp.json()["answer"])
```

---

## Static Swagger UI (offline)

This repository contains a **static snapshot** of the external OpenAPI spec and a Swagger UI page that can be opened locally.

### Files

- `docs/api/swagger/swagger.json` — OpenAPI 3.0 JSON snapshot (external API)
- `docs/api/swagger/swagger-ui.html` — Swagger UI (loads the JSON snapshot)

### How to view locally

Browsers often block `fetch()` for `file://` pages, so run a tiny local server:

```bash
cd docs/api/swagger
python -m http.server 8009
```

Then open:
- `http://localhost:8009/swagger-ui.html`

> This is independent from the actual Ollamify containers — it’s only for documentation browsing.

