# Примеры кода

[English](examples.md) | **Русский**

Задайте:

```bash
BASE_URL="http://localhost/api"
TOKEN="YOUR_JWT_OR_API_KEY"
```

## Логин (JWT)

```bash
curl -sS "http://localhost/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin"}'
```

## Загрузка документа (файл)

```bash
curl -sS "$BASE_URL/documents" \
  -H "Authorization: Bearer $TOKEN" \
  -F "project=my-docs" \
  -F "file=@./my.pdf"
```

## RAG запрос

```bash
curl -sS "$BASE_URL/ai/rag" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "question":"Сделай краткое резюме документа",
    "project":"my-docs",
    "model":"llama3.1:8b",
    "useReranker": true,
    "useHybridSearch": true
  }'
```

## OpenAI‑совместимый чат (curl)

```bash
curl -sS "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"llama3.1:8b",
    "messages":[{"role":"user","content":"Скажи привет"}],
    "stream": false
  }'
```

## JavaScript (fetch)

```javascript
const BASE_URL = "http://localhost/api";
const token = "YOUR_JWT_OR_API_KEY";

const res = await fetch(`${BASE_URL}/ai/rag`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    question: "Что в документах?",
    project: "my-docs",
    model: "llama3.1:8b",
    useReranker: true,
    useHybridSearch: true,
  }),
});

console.log(await res.json());
```

## Python (requests)

```python
import requests

BASE_URL = "http://localhost/api"
token = "YOUR_JWT_OR_API_KEY"

resp = requests.post(
    f"{BASE_URL}/ai/rag",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "question": "Что в документах?",
        "project": "my-docs",
        "model": "llama3.1:8b",
        "useReranker": True,
        "useHybridSearch": True,
    },
    timeout=300,
)

resp.raise_for_status()
print(resp.json()["answer"])
```

## TTS (скачать WAV)

```bash
curl -sS "$BASE_URL/tts/synthesize/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Привет!","voice":"aidar","sample_rate":24000}' \
  -o speech.wav
```

## STT (распознать файл)

```bash
curl -sS "$BASE_URL/stt/transcribe" \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@./sample.wav" \
  -F "language=ru" \
  -F "task=transcribe"
```

