# Документация API

[English](README.md) | **Русский**

Эта страница полезна **ещё до установки системы**: описывает аутентификацию, выбор моделей (Ollama vs OpenRouter), перечисляет все внешние эндпоинты, даёт copy‑paste примеры и offline‑снимок Swagger.

## Base URL

Для локального запуска через gateway (рекомендуется):

- `BASE_URL=http://localhost/api`

Эндпоинты ниже показаны **без** префикса `/api` (как в OpenAPI). Пример:

- Путь: `/documents`
- Полный URL: `http://localhost/api/documents`

## Swagger (live, когда стек запущен)

- **Swagger UI**: `http://localhost/api/docs`
- **OpenAPI JSON**: `http://localhost/api/docs/swagger.json`

## Аутентификация

Для всех защищённых эндпоинтов нужен заголовок:

```
Authorization: Bearer <TOKEN>
```

Где `<TOKEN>` — это либо:

- **JWT** (логин через web UI), либо
- **API key** (для внешних интеграций)

### JWT (web UI)

1) Логин:

- `POST /auth/login`
- body:

```json
{ "email": "admin@example.com", "password": "admin" }
```

- ответ:

```json
{ "token": "..." }
```

2) Использование:

```
Authorization: Bearer <token>
```

### API key (внешние интеграции)

API‑ключи создаются в web UI:

- Users → API keys → Create

Дальше используйте ключ так же, как токен:

```
Authorization: Bearer <api_key>
```

## Выбор моделей (Ollama vs OpenRouter)

Провайдер выбирается **в каждом запросе** через поле `model`.

### Локально (Ollama)

- Обычное имя модели, например `llama3.1:8b`
- Модель должна быть доступна в Ollama (установите через UI → **Models**)

### Прокси (OpenRouter)

- Префикс `openrouter/`, например `openrouter/anthropic/claude-3.5-sonnet`
- Требуется `OPENROUTER_API_KEY` в `.env`

## Быстрый старт (переменные для примеров)

```bash
BASE_URL="http://localhost/api"
TOKEN="YOUR_JWT_OR_API_KEY"
```

---

## API reference (external)

Этот раздел повторяет **внешний** Swagger и предназначен для интеграций.

### Documents

#### GET `/documents`

Список документов (пагинация + фильтры).

**Query параметры**
- `project` (опционально): имя проекта. Если не задан — агрегируется по всем проектам.
- `page` (по умолчанию `1`)
- `limit` (по умолчанию `10`)
- `order_by` (`created_at|name|total_chunks|loaded_chunks`, по умолчанию `created_at`)
- `order` (`ASC|DESC`, по умолчанию `DESC`)
- `search` (опционально): поиск по имени документа

**Пример**

```bash
curl -sS "$BASE_URL/documents?project=my-docs&page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

#### POST `/documents`

Загрузка документа:
- файлом (`multipart/form-data`), или
- текстом (`application/json`)

Индексация асинхронная — прогресс смотрите через `loaded_chunks / total_chunks` в списке документов.

**Multipart поля**
- `file` (PDF/DOCX/TXT)
- `project` (обязательно)
- `name` (опционально)
- `metadata` (опционально JSON)
- `external_id` (опционально): для идемпотентности
- `single_chunk` (опционально boolean): не делить на чанки

**Пример (файл)**

```bash
curl -sS "$BASE_URL/documents" \
  -H "Authorization: Bearer $TOKEN" \
  -F "project=my-docs" \
  -F "file=@./my.pdf"
```

**Пример (текст)**

```bash
curl -sS "$BASE_URL/documents" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"project":"my-docs","name":"notes","content":"Hello world"}'
```

#### GET `/documents/projects`

Список проектов и их embedding‑моделей.

```bash
curl -sS "$BASE_URL/documents/projects" \
  -H "Authorization: Bearer $TOKEN"
```

#### GET `/documents/{id}`

Получить документ по id (обязателен query `project`).

```bash
curl -sS "$BASE_URL/documents/123?project=my-docs" \
  -H "Authorization: Bearer $TOKEN"
```

#### DELETE `/documents/{id}`

Удалить документ (обязателен query `project`).

```bash
curl -sS -X DELETE "$BASE_URL/documents/123?project=my-docs" \
  -H "Authorization: Bearer $TOKEN"
```

---

### AI & RAG

#### POST `/ai/rag`

RAG ответ: найти релевантные фрагменты и сгенерировать ответ LLM‑моделью.

**Body (минимум)**
- `question` (обязательно)
- `project` (обязательно)
- `model` (обязательно): Ollama модель (`llama3.1:8b`) или OpenRouter через префикс `openrouter/...`

**Опции**
- `useReranker` (по умолчанию `true`)
- `limit` (по умолчанию `30`)
- `think` (по умолчанию `true`)
- `useHybridSearch` (по умолчанию `true`)

**Пример**

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

Вернуть только чанки (без генерации ответа).

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

OpenAI‑style эмбеддинги (на базе Ollama embeddings).

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

Совместимый с OpenAI Chat Completions эндпоинт.

**Важно**
- Если `model` начинается с `openrouter/`, запрос уйдёт в OpenRouter.
- `stream=true` поддерживается для **Ollama** моделей и не поддерживается для **OpenRouter** моделей.

**Пример**

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

Возвращает JSON с base64 WAV.

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

Возвращает бинарный WAV (используйте `-o`).

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

## Примеры кода (JS/Python)

### Логин (JWT)

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
    question: "Что в документах?",
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
        "question": "Что в документах?",
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

## Статическая Swagger UI (offline)

В репозитории лежит **статический снимок** внешней OpenAPI‑спеки и страница Swagger UI, которую можно открыть локально.

### Файлы

- `docs/api/swagger/swagger.json` — OpenAPI 3.0 JSON snapshot (external API)
- `docs/api/swagger/swagger-ui.html` — Swagger UI (подгружает JSON snapshot)

### Как посмотреть локально

Браузеры часто блокируют `fetch()` для `file://`, поэтому поднимите простой локальный сервер:

```bash
cd docs/api/swagger
python -m http.server 8009
```

Откройте:
- `http://localhost:8009/swagger-ui.html`

> Это не зависит от контейнеров Ollamify — только для просмотра документации.

