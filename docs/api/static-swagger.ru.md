# Статическая Swagger UI (offline)

[English](static-swagger.md) | **Русский**

В репозитории лежит **статический снимок** внешней OpenAPI‑спеки и страница Swagger UI, которую можно открыть локально.

## Файлы

- `docs/api/swagger/swagger.json` — OpenAPI 3.0 JSON snapshot (external API)
- `docs/api/swagger/swagger-ui.html` — Swagger UI (подгружает JSON snapshot)

## Как посмотреть локально

Браузеры часто блокируют `fetch()` для `file://`, поэтому поднимите простой локальный сервер:

```bash
cd docs/api/swagger
python -m http.server 8009
```

Откройте:
- `http://localhost:8009/swagger-ui.html`

> Это не зависит от контейнеров Ollamify — только для просмотра документации.

