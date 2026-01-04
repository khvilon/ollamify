# Ollamify

[English](README.md) | **Русский**

Ollamify — это self‑hosted **AI‑gateway** для разработчиков: вы можете развернуть его локально (или предоставлять как собственный SaaS) и подключать ИИ‑возможности в свои продукты через единый API.

Из коробки доступны production‑ready компоненты:
- **RAG по документам** (ингест → гибридная выдача → опциональный реранкер → ответ)
- **Текстовые ответы** (включая **OpenAI‑совместимый** Chat Completions эндпоинт)
- **Голос**: **TTS** (текст → речь) и **STT** (речь → текст)
- **Маршрутизация моделей**:
  - локальные модели через **Ollama**
  - проксирование в **OpenRouter** (через имена моделей с префиксом `openrouter/...`)
- **Разделение доступа под разные приложения**: пользователи + API‑ключи (один Ollamify может обслуживать несколько систем)
- **Web UI** для управления проектами/моделями/пользователями и тестирования в виде чата

Детали архитектуры: [`docs/architecture.ru.md`](docs/architecture.ru.md)

## Маршрутизация моделей (локальные Ollama vs OpenRouter)

Провайдер выбирается **на каждый запрос**:

- **Локально (Ollama)**: обычное имя модели, например:
  - `model: "llama3.1:8b"`
- **Прокси (OpenRouter)**: префикс `openrouter/`, например:
  - `model: "openrouter/anthropic/claude-3.5-sonnet"`

Это работает для:
- `POST /api/ai/rag`
- `POST /api/v1/chat/completions` (OpenAI‑совместимый)

См.: [`docs/api/reference.ru.md`](docs/api/reference.ru.md)

## Быстрый старт

### 1) Настройка окружения

Скопируйте пример и отредактируйте:

```bash
cp .env_example .env
```

Минимально нужно для локального запуска:
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `JWT_SECRET`

Опционально:
- `OPENROUTER_API_KEY`, `OPENROUTER_URL` (если хотите OpenRouter)

### 2) Запуск (CPU или GPU)

**Linux/macOS/WSL/Git Bash** (рекомендуется, авто‑детект GPU):

```bash
./start.sh
# принудительно CPU
./start.sh --cpu
```

**Windows (PowerShell)**:

```powershell
docker compose up -d
# GPU режим
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

### 3) Откройте UI

- **Web UI**: `http://localhost`
- **Дефолтные учётные данные (dev)**: `admin@example.com` / `admin`

## Как пользоваться (первые шаги)

- **Создайте проект**: UI → Projects → New Project
  - Выберите **embedding‑модель** (модель должна быть доступна в Ollama)
- **Загрузите документы**: UI → Documents → Upload (или вставьте текст)
  - Прогресс индексации видно по `loaded_chunks / total_chunks`
- **Чат с документами**: UI → Chat
  - Выберите проект, модель и при необходимости включите гибридный поиск / реранкер

## Документация

- **Оглавление**: [`docs/README.ru.md`](docs/README.ru.md)
- **Документация API (удобно до установки)**: [`docs/api/README.ru.md`](docs/api/README.ru.md)
- **UI гайд**: [`docs/ui/README.ru.md`](docs/ui/README.ru.md)
- **Конфигурация**: [`docs/configuration.ru.md`](docs/configuration.ru.md)
- **Архитектура**: [`docs/architecture.ru.md`](docs/architecture.ru.md)
- **Troubleshooting**: [`docs/troubleshooting.ru.md`](docs/troubleshooting.ru.md)

