# Architecture

**Language:** **English** | [Русский](architecture.ru.md)

## System diagram (GitHub-rendered)

```mermaid
flowchart LR
  user[User / Browser] -->|HTTP :80| nginx[www3 / Nginx (UI + /api gateway)]

  nginx -->|POST /auth/login| auth[auth service]
  nginx -->|/api/* (protected)| zeus[zeus API]
  nginx -->|/api/tts/* (protected)| tts[tts service]
  nginx -->|/api/stt/* (protected)| stt[stt service]
  nginx -->|/ws/* (WebSocket)| zeus

  zeus -->|SQL| pg[(PostgreSQL)]
  zeus -->|REST :6333| qdrant[(Qdrant)]
  zeus -->|HTTP :11434| ollama[Ollama]
  zeus -->|HTTP :8001| reranker[Reranker]
  zeus -->|HTTP :8002| frida[Frida]
```

## High-level view

- `www3` (Nginx) is the **single entry point** for the UI and the `/api` gateway.
- `auth` verifies JWT / API keys (via Nginx `auth_request`).
- `zeus` is the main backend: projects, documents, RAG, model management, OpenAPI generation.
- `ollama` provides local LLM + embeddings runtime.
- `vector-db` runs Qdrant (vector search).
- `db` is PostgreSQL (+ pgvector extension; admin tables are in `admin` schema).
- `tts` and `stt` are separate services exposed under `/api/tts/*` and `/api/stt/*`.

## Ports (default)

| Service | Container port | Host port |
|---|---:|---:|
| www3 (Nginx) | 80 | 80 |
| zeus | 80 | (internal) |
| auth | 80 | (internal) |
| db (Postgres) | 5432 | (internal) |
| vector-db (Qdrant) | 6333 | 6333 |
| frida | 8002 | 8002 |
| reranker | 8001 | 8001 |
| tts | 8003 | 8003 |
| stt | 8004 | 8004 |

## Gateway routing (Nginx)

- `POST /auth/login` → `auth`
- `/api/*` → `zeus` (authenticated)
- `/api/tts/*` → `tts` (authenticated)
- `/api/stt/*` → `stt` (authenticated)
- `/api/docs` → `zeus` (public Swagger UI)

## Key flows

### Document ingestion (upload → chunks → embeddings → Qdrant)

```mermaid
sequenceDiagram
  participant UI as Browser/UI
  participant GW as Nginx (/api)
  participant Zeus as zeus
  participant PG as PostgreSQL
  participant Ollama as Ollama
  participant Q as Qdrant

  UI->>GW: POST /api/documents (file or text)
  GW->>Zeus: POST /api/documents
  Zeus->>PG: INSERT document metadata (admin/projects + {project}.documents)
  loop for each chunk
    Zeus->>Ollama: POST /api/embeddings (model = project's embedding_model)
    Ollama-->>Zeus: embedding vector
    Zeus->>Q: upsert points (payload includes document_id, content, metadata)
    Zeus->>PG: UPDATE loaded_chunks
  end
  Zeus-->>UI: 200 Created (+ async progress via WS)
```

### RAG request (hybrid retrieval → optional rerank → answer)

```mermaid
sequenceDiagram
  participant Client as Client
  participant GW as Nginx (/api)
  participant Zeus as zeus
  participant Ollama as Ollama
  participant Q as Qdrant
  participant R as reranker
  participant OR as OpenRouter

  Client->>GW: POST /api/ai/rag
  GW->>Zeus: POST /api/ai/rag
  Zeus->>Ollama: embeddings for intent query (project embedding model)
  Ollama-->>Zeus: vector
  Zeus->>Q: vector search (+ optional keyword search)
  Q-->>Zeus: relevant chunks
  opt useReranker = true
    Zeus->>R: POST /rerank (query + chunks)
    R-->>Zeus: reranked chunks
  end
  alt model starts with openrouter/
    Zeus->>OR: chat.completions (OpenRouter)
    OR-->>Zeus: answer
  else local Ollama model
    Zeus->>Ollama: /v1/chat/completions
    Ollama-->>Zeus: answer
  end
  Zeus-->>Client: answer + sources (+ optional thinking)
```


