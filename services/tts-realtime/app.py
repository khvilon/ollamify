from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict
from fastapi.responses import Response
import base64
import logging
import tempfile
import subprocess
import os
import time
import wave


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Ollamify Realtime TTS Service",
    description="Lightweight offline multilingual TTS service (ru/en/he) based on espeak-ng",
    version="1.1.0",
)


SUPPORTED_LANGUAGES = {"ru", "en", "he"}
DEFAULT_VOICE_BY_LANGUAGE = {
    "ru": "ru",
    "en": "en-us",
    "he": "he",
}
VOICE_INFOS = [
    {"name": "ru", "gender": "unknown", "language": "ru", "description": "eSpeak NG Russian"},
    {"name": "en-us", "gender": "unknown", "language": "en", "description": "eSpeak NG English (US)"},
    {"name": "he", "gender": "unknown", "language": "he", "description": "eSpeak NG Hebrew"},
]


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    speed: Optional[float] = 1.0
    sample_rate: Optional[int] = 24000
    format: Optional[str] = "wav"
    language: Optional[str] = "ru"


class TTSResponse(BaseModel):
    audio_base64: str
    format: str
    sample_rate: int
    duration_ms: int


class VoiceInfo(BaseModel):
    name: str
    gender: str
    language: str
    description: str


def normalize_lang(value: Optional[str]) -> str:
    lang = (value or "ru").strip().lower()
    return lang if lang in SUPPORTED_LANGUAGES else "ru"


def clamp_speed(value: Optional[float]) -> float:
    speed = value if value is not None else 1.0
    return min(2.0, max(0.5, speed))


def speed_to_wpm(speed: float) -> int:
    # Base speed for espeak is around 175 wpm.
    return int(round(175 * speed))


def resolve_voice(requested_voice: Optional[str], language: str) -> str:
    valid_voices = {voice["name"] for voice in VOICE_INFOS}
    if requested_voice and requested_voice in valid_voices:
        return requested_voice
    return DEFAULT_VOICE_BY_LANGUAGE.get(language, "en-us")


def synthesize_wav(text: str, voice: str, speed: float) -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_wav:
        wav_path = temp_wav.name

    try:
        command = [
            "espeak-ng",
            "-v",
            voice,
            "-s",
            str(speed_to_wpm(speed)),
            "-w",
            wav_path,
            text,
        ]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "espeak-ng failed")

        with open(wav_path, "rb") as audio_file:
            return audio_file.read()
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)


def estimate_duration_ms(wav_bytes: bytes) -> int:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_wav:
        wav_path = temp_wav.name
        temp_wav.write(wav_bytes)

    try:
        with wave.open(wav_path, "rb") as wav_file:
            frames = wav_file.getnframes()
            rate = wav_file.getframerate() or 1
            return int(frames / rate * 1000)
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "realtime-tts",
        "provider": "espeak-ng",
        "supported_languages": sorted(list(SUPPORTED_LANGUAGES)),
        "voices_total": len(VOICE_INFOS),
    }


@app.get("/voices", response_model=List[VoiceInfo])
async def get_voices():
    return VOICE_INFOS


@app.post("/synthesize", response_model=TTSResponse)
async def synthesize(request: TTSRequest):
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Пустой текст")
    if len(request.text) > 2000:
        raise HTTPException(status_code=400, detail="Текст слишком длинный (максимум 2000 символов)")

    language = normalize_lang(request.language)
    voice = resolve_voice(request.voice, language)
    speed = clamp_speed(request.speed)

    start = time.time()
    try:
        wav_bytes = synthesize_wav(request.text.strip(), voice, speed)
    except Exception as error:
        logger.error("Synthesis failed: %s", error)
        raise HTTPException(status_code=503, detail=f"Синтез временно недоступен: {error}")

    duration_ms = estimate_duration_ms(wav_bytes)
    _ = int((time.time() - start) * 1000)

    return TTSResponse(
        audio_base64=base64.b64encode(wav_bytes).decode("utf-8"),
        format="wav",
        sample_rate=request.sample_rate or 24000,
        duration_ms=duration_ms,
    )


@app.post("/synthesize/stream")
async def synthesize_stream(request: TTSRequest):
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Пустой текст")

    language = normalize_lang(request.language)
    voice = resolve_voice(request.voice, language)
    speed = clamp_speed(request.speed)

    try:
        wav_bytes = synthesize_wav(request.text.strip(), voice, speed)
    except Exception as error:
        logger.error("Stream synthesis failed: %s", error)
        raise HTTPException(status_code=503, detail=f"Синтез временно недоступен: {error}")

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "Content-Disposition": "attachment; filename=speech.wav",
            "Content-Length": str(len(wav_bytes)),
        },
    )


@app.get("/")
async def root():
    return {
        "service": "Ollamify Realtime TTS",
        "provider": "espeak-ng",
        "version": "1.1.0",
        "languages": sorted(list(SUPPORTED_LANGUAGES)),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8006)
