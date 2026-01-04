# Ollamify

**Language:** **English** | [Русский](README.ru.md)

Ollamify is a self‑hosted **AI gateway** for developers: deploy it locally (or run it as your own SaaS) and integrate AI into your products via a single, stable API.

It provides production‑ready building blocks out of the box:
- **RAG over documents** (ingestion → hybrid retrieval → optional rerank → answer)
- **Text generation** (including an **OpenAI‑compatible** Chat Completions endpoint)
- **Speech**: **TTS** (text → speech) and **STT** (speech → text)
- **Model routing**:
  - local models via **Ollama**
  - proxied models via **OpenRouter** (by using `openrouter/...` model names)
- **Multi-tenant access control**: users + API keys (one Ollamify instance can serve multiple apps)
- **Web UI** to manage projects/models/users and to test everything in a chat

For architecture details: [`docs/architecture.md`](docs/architecture.md)

## Model routing (local Ollama vs OpenRouter)

You choose the provider **per request**:

- **Local (Ollama)**: send a normal model name, for example:
  - `model: "llama3.1:8b"`
- **Proxy (OpenRouter)**: prefix with `openrouter/`, for example:
  - `model: "openrouter/anthropic/claude-3.5-sonnet"`

This works for:
- `POST /api/ai/rag`
- `POST /api/v1/chat/completions` (OpenAI-compatible)

See: [`docs/api/reference.md`](docs/api/reference.md)

## Quickstart

### 1) Configure environment

Copy the example file and edit it:

```bash
cp .env_example .env
```

Minimum required for local run:
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `JWT_SECRET`

Optional:
- `OPENROUTER_API_KEY`, `OPENROUTER_URL` (only if you want OpenRouter models)

### 2) Start (CPU or GPU)

**Linux/macOS/WSL/Git Bash** (recommended, auto GPU detection):

```bash
./start.sh
# force CPU mode
./start.sh --cpu
```

**Windows (PowerShell)**:

```powershell
docker compose up -d
# GPU mode
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

### 3) Open the UI

- **Web UI**: `http://localhost`
- **Default credentials (dev)**: `admin@example.com` / `admin`

## How to use (first steps)

- **Create a project**: UI → Projects → New Project
  - Choose an **embedding model** (the model must be available in Ollama)
- **Upload documents**: UI → Documents → Upload (or paste text)
  - Watch `loaded_chunks / total_chunks` to see indexing progress
- **Chat with your docs**: UI → Chat
  - Select a project, model, and toggle hybrid search / reranker if needed

## Documentation

- **Docs index**: [`docs/README.md`](docs/README.md)
- **API docs (pre-install friendly)**: [`docs/api/README.md`](docs/api/README.md)
- **UI guide**: [`docs/ui/README.md`](docs/ui/README.md)
- **Configuration**: [`docs/configuration.md`](docs/configuration.md)
- **Architecture**: [`docs/architecture.md`](docs/architecture.md)
- **Troubleshooting**: [`docs/troubleshooting.md`](docs/troubleshooting.md)

