# Static Swagger UI (offline)

**Language:** **English** | [Русский](static-swagger.ru.md)

This repository contains a **static snapshot** of the external OpenAPI spec and a Swagger UI page that can be opened locally.

## Files

- `docs/api/swagger/swagger.json` — OpenAPI 3.0 JSON snapshot (external API)
- `docs/api/swagger/swagger-ui.html` — Swagger UI (loads the JSON snapshot)

## How to view locally

Browsers often block `fetch()` for `file://` pages, so run a tiny local server:

```bash
cd docs/api/swagger
python -m http.server 8009
```

Then open:
- `http://localhost:8009/swagger-ui.html`

> This is independent from the actual Ollamify containers — it’s only for documentation browsing.

