# Voice (TTS/STT)

[English](voice.md) | **Русский**

Путь в UI: `/voice`

Страница‑песочница для:

- **TTS**: синтез речи (Silero)
- **STT**: распознавание речи (Whisper)

## Вкладка TTS

### Управление

- **Voice**: загружается из `GET /api/tts/voices`
- **Language**: сейчас только `ru` (в UI отключено)
- **Speed**: 0.5× … 2.0×
- **Quality (sample rate)**: 8k / 24k / 48k
- **Quick phrases**: быстрые фразы для заполнения текста

### Как синтезировать

1) Введите текст (до 1000 символов)
2) Нажмите **Synthesize**
3) Аудио воспроизведётся автоматически
4) Опционально: **Download** чтобы сохранить WAV

UI вызывает:
- `POST /api/tts/synthesize/stream`

## Вкладка STT

### Управление

- **Whisper model**:
  - список из `GET /api/stt/models`
  - переключение вызывает `POST /api/stt/model/load`
- **Language**: язык распознавания (по умолчанию `ru`)

### Как распознать

1) Нажмите кнопку микрофона для старта записи
2) Нажмите ещё раз для остановки
3) Дождитесь результата

UI вызывает:
- `POST /api/stt/transcribe` (multipart)

### Действия с результатом

- Copy
- Clear
- Отправить в TTS (“Synthesize”)

