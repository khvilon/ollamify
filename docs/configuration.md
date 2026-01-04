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

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (use `openrouter/...` prefix in requests)
- `OPENROUTER_URL` (default OpenRouter chat completions endpoint)

## Defaults created on first start

On first boot the database initialization creates a default admin user:

- email: `admin@example.com`
- password: `admin`

Change credentials and secrets for any non-local deployment.

