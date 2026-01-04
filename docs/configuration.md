# Configuration

**Language:** **English** | [Русский](configuration.ru.md)

## Environment file

The stack uses a root `.env` file. Start from:

```bash
cp .env_example .env
```

## Variables

### Required

- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`
- `JWT_SECRET`

### Optional

- `OPENROUTER_API_KEY` (only if you want OpenRouter models)
- `OPENROUTER_URL` (optional; default OpenRouter chat completions endpoint)

> You select OpenRouter models **per request** by using the `openrouter/...` prefix in the `model` field.

## Defaults created on first start

On first boot the database initialization creates a default admin user:

- email: `admin@example.com`
- password: `admin`

Change credentials and secrets for any non-local deployment.

