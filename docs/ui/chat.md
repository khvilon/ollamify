# Chat

**Language:** **English** | [Русский](chat.ru.md)

Path in UI: `/chat`

## Purpose

Chat with your documents using RAG:

- selects relevant chunks from your project
- optionally reranks them
- generates an answer with your chosen model

## Controls (top bar)

- **Project**: determines which document index is used
- **Model**:
  - local Ollama models (installed)
  - OpenRouter models (prefixed as `openrouter/...`)
  - embedding-only models are hidden from this list
- **Use Reranker**: toggles reranking stage
- **Hybrid search**: combines vector + keyword search
- **Show thinking**: shows the model “thinking” section if available

## Asking questions

1) Select a project and model  
2) Type a message and press **Send**

The UI calls:
- `POST /api/ai/rag`

## Sources panel

Assistant responses can include:

- **Thinking** (collapsible)
- **Sources** (collapsible): filename, similarity, chunk content, metadata

## Push-to-talk (STT)

The chat input has a mic button:

- Hold to record → release to send
- UI sends audio to:
  - `POST /api/stt/transcribe` (language defaults to `ru`)
- The transcribed text is then sent as a normal chat message

## Notes / limitations

- You must have at least one project and at least one non-embedding model available.
- If STT/TTS services are not running, voice features will fail.

