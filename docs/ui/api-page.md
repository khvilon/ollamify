# API page (Swagger in UI)

**Language:** **English** | [Русский](api-page.ru.md)

Path in UI: `/swagger`

This page bundles API onboarding for UI users:

- overview of external endpoints
- your API keys (quick copy)
- code examples (curl / Python / JS)
- embedded Swagger UI (`/api/docs`)

## Tabs

### API Overview

- Lists the main endpoint groups and their purpose.

### My API Keys

- Shows API keys for the current user
- You can copy the key value
- For management (create/delete), it links you to `/users`

### Code Examples

- Copy‑paste examples for:
  - RAG
  - OpenAI-compatible chat
  - TTS

### Swagger Docs

- Embedded interactive Swagger UI loaded from `/api/docs`
- Tip: click **Authorize** and paste your token/key as:

```
Bearer <TOKEN>
```

