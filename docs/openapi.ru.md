# OpenAPI / Swagger

[English](openapi.md) | **Русский**

Если нужен pre-install гайд «для людей» — начните отсюда:
- [`docs/api/README.ru.md`](api/README.ru.md)

## Где смотреть документацию

- **Внешняя Swagger UI** (рекомендуется): `http://localhost/api/docs`
- **Внешний OpenAPI JSON**: `http://localhost/api/docs/swagger.json`

## Статический снимок (в репозитории)

- OpenAPI JSON: `docs/api/swagger/swagger.json`
- Swagger UI (offline): `docs/api/static-swagger.ru.md`

External OpenAPI генерируется сервисом `zeus` (Swagger JSDoc) и предназначен для:
- внешних интеграций (API‑ключи)
- автоматизации / скриптов
- OpenAI‑совместимого чата

## Base URL и маршрутизация

Публичные эндпоинты доступны через gateway‑префикс:

- **База**: `/api`
- Пример: `/api/projects`, `/api/documents`, `/api/ai/rag`

TTS и STT — отдельные сервисы, но наружу они доступны через тот же gateway:

- `/api/tts/*` → `services/tts`
- `/api/stt/*` → `services/stt`

## Аутентификация

Для защищённых эндпоинтов используйте заголовок:

```
Authorization: Bearer <JWT или API_KEY>
```

Два типовых сценария:

### UI / JWT

1) Логин:
- `POST /auth/login`
- body: `{ "email": "...", "password": "..." }`
- ответ: `{ "token": "..." }`

2) Используйте токен:
- `Authorization: Bearer <token>`

### External / API key

API‑ключи создаются/управляются в UI (Users → API keys).

Далее используйте:
- `Authorization: Bearer <api_key>`

## OpenAI‑совместимый эндпоинт

Доступно:

- `POST /api/v1/chat/completions`

Эндпоинт совместим с OpenAI Chat Completions API (точная схема — в Swagger).

