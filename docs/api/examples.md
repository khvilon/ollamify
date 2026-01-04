# Code examples

**Language:** **English** | [Русский](examples.ru.md)

Set:

```bash
BASE_URL="http://localhost/api"
TOKEN="YOUR_JWT_OR_API_KEY"
```

## Login (JWT)

```bash
curl -sS "http://localhost/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin"}'
```

## Upload a document (file)

```bash
curl -sS "$BASE_URL/documents" \
  -H "Authorization: Bearer $TOKEN" \
  -F "project=my-docs" \
  -F "file=@./my.pdf"
```

## Ask RAG question

```bash
curl -sS "$BASE_URL/ai/rag" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "question":"Summarize the document",
    "project":"my-docs",
    "model":"llama3.1:8b",
    "useReranker": true,
    "useHybridSearch": true
  }'
```

## OpenAI-compatible chat completions (curl)

```bash
curl -sS "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"llama3.1:8b",
    "messages":[{"role":"user","content":"Say hello"}],
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
    question: "What is in the docs?",
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
        "question": "What is in the docs?",
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

## TTS (download WAV)

```bash
curl -sS "$BASE_URL/tts/synthesize/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Привет!","voice":"aidar","sample_rate":24000}' \
  -o speech.wav
```

## STT (transcribe audio file)

```bash
curl -sS "$BASE_URL/stt/transcribe" \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@./sample.wav" \
  -F "language=ru" \
  -F "task=transcribe"
```

