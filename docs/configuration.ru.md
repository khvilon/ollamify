# Конфигурация

[English](configuration.md) | **Русский**

## Файл окружения

Стек использует корневой `.env`. Начните с:

```bash
cp .env_example .env
```

## Переменные

### Обязательные

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`
- `JWT_SECRET`

### Опциональные

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (в запросах используется префикс `openrouter/...`)
- `OPENROUTER_URL` (эндпоинт OpenRouter chat completions)

## Дефолты при первом запуске

При первом запуске в БД создаётся дефолтный админ:

- email: `admin@example.com`
- пароль: `admin`

Для любого не‑локального деплоя обязательно меняйте пароли/секреты.

