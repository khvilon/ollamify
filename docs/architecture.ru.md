# Архитектура

[English](architecture.md) | **Русский**

## Общая картина

- `www3` (Nginx) — **единая точка входа** для UI и `/api` gateway.
- `auth` проверяет JWT / API‑ключи (через Nginx `auth_request`).
- `zeus` — основной backend: проекты, документы, RAG, модели, генерация OpenAPI.
- `ollama` — локальный runtime для LLM + embeddings.
- `vector-db` — Qdrant (векторный поиск).
- `db` — PostgreSQL (+ pgvector; служебные таблицы в схеме `admin`).
- `tts` и `stt` — отдельные сервисы, наружу идут через `/api/tts/*` и `/api/stt/*`.

## Порты (по умолчанию)

| Сервис | Порт в контейнере | Порт на хосте |
|---|---:|---:|
| www3 (Nginx) | 80 | 80 |
| zeus | 80 | (внутри сети) |
| auth | 80 | (внутри сети) |
| db (Postgres) | 5432 | (внутри сети) |
| vector-db (Qdrant) | 6333 | 6333 |
| frida | 8002 | 8002 |
| reranker | 8001 | 8001 |
| tts | 8003 | 8003 |
| stt | 8004 | 8004 |

## Роутинг gateway (Nginx)

- `POST /auth/login` → `auth`
- `/api/*` → `zeus` (с авторизацией)
- `/api/tts/*` → `tts` (с авторизацией)
- `/api/stt/*` → `stt` (с авторизацией)
- `/api/docs` → `zeus` (публичная Swagger UI)

