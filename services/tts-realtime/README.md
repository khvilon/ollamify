# Ollamify realtime TTS service (OmniVoice)

This is the active TTS service for the default Docker stack.

## Runtime

- Model: `k2-fsa/OmniVoice`
- Package: `omnivoice==0.1.5`
- Container: `tts-realtime`
- Internal port: `8006`
- Gateway path: `/api/tts/*` -> `zeus` -> `tts-realtime:8006`
- Model cache volume: `ollamify-tts-hf-cache`

## Defaults

- `OMNIVOICE_DEVICE=cuda:0` in GPU compose
- `OMNIVOICE_NUM_STEP=10`
- `OMNIVOICE_SYNTHESIS_ATTEMPTS=2`
- `TTS_DEFAULT_SPEED=0.65`
- Sample rate: `24000`

## Voices

- `omnivoice-ru`: Russian auto voice
- `omnivoice-en`: English auto voice
- `omnivoice-he`: Hebrew voice with OmniVoice `instruct="young adult, high pitch"`

## Endpoints

- `GET /health`
- `GET /voices`
- `POST /synthesize`
- `POST /synthesize/stream`
- `POST /synthesize/pcm-stream`

## Example

```bash
curl -sS http://localhost:8006/synthesize/stream \
  -H "Content-Type: application/json" \
  -d '{"text":"שלום","voice":"omnivoice-he","language":"he","speed":0.65,"sample_rate":24000}' \
  -o speech.wav
```

## Portable build

The default Dockerfile base is `python:3.11-slim` so the image can build on a clean machine.
For local rebuilds where a CUDA/Torch base image is already prepared, pass:

```bash
docker build \
  --build-arg BASE_IMAGE=ollamify-tts-realtime-base:torch-cu128 \
  -t ollamify-tts-realtime:latest \
  services/tts-realtime
```
