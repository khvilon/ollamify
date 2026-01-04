# Ollamify TTS service (Silero TTS)

This service provides **Text-to-Speech** using **Silero TTS** (current implementation: Russian voices).

In the full stack it is exposed via the gateway as:
- `/api/tts/*` → this service

## Endpoints (service-level)

- `GET /health` — service + model status
- `GET /voices` — available voices
- `POST /synthesize` — synthesize speech (base64 WAV)
- `POST /synthesize/stream` — synthesize speech (binary WAV)

## Voices

Currently available RU voices:
- `aidar` (male)
- `baya` (female)
- `kseniya` (female)
- `xenia` (female)

## Request example

```json
{
  "text": "Привет! Как дела?",
  "voice": "aidar",
  "speed": 1.0,
  "sample_rate": 24000,
  "format": "wav",
  "language": "ru"
}
```

## Notes

- Local docs (FastAPI): `http://localhost:8003/docs`
- Gateway docs: `http://localhost/api/docs`
- The `/health` response contains the license string used by the service.