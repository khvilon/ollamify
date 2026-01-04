# Voice (TTS/STT)

**Language:** **English** | [Русский](voice.ru.md)

Path in UI: `/voice`

This page is a playground for:

- **TTS**: Text-to-Speech (Silero)
- **STT**: Speech-to-Text (Whisper)

## TTS tab

### Controls

- **Voice**: fetched from `GET /api/tts/voices`
- **Language**: currently `ru` only (disabled in UI)
- **Speed**: 0.5× … 2.0×
- **Quality (sample rate)**: 8k / 24k / 48k
- **Quick phrases**: one-click presets to fill the text box

### How to synthesize

1) Enter text (up to 1000 chars)
2) Click **Synthesize**
3) Audio plays automatically
4) Optional: **Download** to save WAV

The UI calls:
- `POST /api/tts/synthesize/stream`

## STT tab

### Controls

- **Whisper model**:
  - list from `GET /api/stt/models`
  - switching triggers `POST /api/stt/model/load`
- **Language**: choose transcription language (default `ru`)

### How to transcribe

1) Click the mic button to start recording
2) Click again to stop
3) Wait for transcription result

The UI calls:
- `POST /api/stt/transcribe` (multipart form)

### Actions on result

- Copy
- Clear
- Send to TTS (“Synthesize” button)

