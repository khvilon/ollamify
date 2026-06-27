import base64
import io
import logging
import os
from threading import Lock
from typing import Any, List, Optional, Tuple

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Ollamify Realtime TTS Service",
    description="Multilingual TTS service (ru/en/he) based on OmniVoice",
    version="4.0.0",
)


SUPPORTED_LANGUAGES = {"ru", "en", "he"}
HEBREW_YOUNG_VOICE_INSTRUCT = (
    "young adult, high pitch"
)
VOICE_INFOS = [
    {"name": "omnivoice-ru", "gender": "auto", "language": "ru", "description": "OmniVoice Auto Russian"},
    {"name": "omnivoice-en", "gender": "auto", "language": "en", "description": "OmniVoice Auto English"},
    {"name": "omnivoice-he", "gender": "young", "language": "he", "description": "OmniVoice Young Hebrew"},
]
VOICE_TO_LANGUAGE = {item["name"]: item["language"] for item in VOICE_INFOS}
VOICE_TO_INSTRUCT = {
    "omnivoice-he": HEBREW_YOUNG_VOICE_INSTRUCT,
}
DEFAULT_VOICE_BY_LANGUAGE = {
    "ru": "omnivoice-ru",
    "en": "omnivoice-en",
    "he": "omnivoice-he",
}

OMNIVOICE_MODEL_ID = os.environ.get("OMNIVOICE_MODEL_ID", "k2-fsa/OmniVoice")
OMNIVOICE_NUM_STEP = int(os.environ.get("OMNIVOICE_NUM_STEP", "10"))
OMNIVOICE_SYNTHESIS_ATTEMPTS = max(1, int(os.environ.get("OMNIVOICE_SYNTHESIS_ATTEMPTS", "2")))
DEFAULT_TTS_SPEED = float(os.environ.get("TTS_DEFAULT_SPEED", "0.65"))
PRELOAD_MODEL_ON_STARTUP = os.environ.get("TTS_PRELOAD_ON_STARTUP", "1").strip() != "0"

_MODEL_LOCK = Lock()
_GENERATION_LOCK = Lock()
_omnivoice_model: Optional[Any] = None
_model_device = "cpu"
_model_dtype = torch.float32
_sample_rate = 24000


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    speed: Optional[float] = DEFAULT_TTS_SPEED
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


def normalize_speed(value: Optional[float]) -> float:
    if value is None:
        return DEFAULT_TTS_SPEED
    speed = float(value)
    if speed <= 0:
        raise ValueError("speed must be greater than 0")
    return speed


def _detect_device_map() -> str:
    forced = (os.environ.get("OMNIVOICE_DEVICE") or "").strip().lower()
    if forced:
        if forced.startswith("cuda") and not torch.cuda.is_available():
            logger.warning("OMNIVOICE_DEVICE=%s requested, but CUDA is unavailable. Falling back to CPU.", forced)
            return "cpu"
        return forced
    return "cuda:0" if torch.cuda.is_available() else "cpu"


def _resolve_dtype(device_map: str) -> torch.dtype:
    forced = (os.environ.get("OMNIVOICE_DTYPE") or "").strip().lower()
    if forced in {"float16", "fp16"}:
        return torch.float16
    if forced in {"bfloat16", "bf16"}:
        return torch.bfloat16
    if forced in {"float32", "fp32"}:
        return torch.float32
    return torch.float16 if device_map.startswith("cuda") else torch.float32


def _load_model() -> Any:
    global _omnivoice_model, _model_device, _model_dtype, _sample_rate

    with _MODEL_LOCK:
        if _omnivoice_model is not None:
            return _omnivoice_model

        try:
            from omnivoice import OmniVoice
        except Exception as error:
            raise RuntimeError("OmniVoice runtime is unavailable. Install the omnivoice Python package.") from error

        _model_device = _detect_device_map()
        _model_dtype = _resolve_dtype(_model_device)
        logger.info(
            "Loading OmniVoice model %s on device_map=%s (dtype=%s, num_step=%s)",
            OMNIVOICE_MODEL_ID,
            _model_device,
            _model_dtype,
            OMNIVOICE_NUM_STEP,
        )

        _omnivoice_model = OmniVoice.from_pretrained(
            OMNIVOICE_MODEL_ID,
            device_map=_model_device,
            dtype=_model_dtype,
        )
        _sample_rate = int(getattr(_omnivoice_model, "sampling_rate", 24000) or 24000)
        logger.info("OmniVoice model loaded successfully (sample_rate=%s)", _sample_rate)
        return _omnivoice_model


def resolve_voice(requested_voice: Optional[str], language: str) -> str:
    if requested_voice and VOICE_TO_LANGUAGE.get(requested_voice) == language:
        return requested_voice
    return DEFAULT_VOICE_BY_LANGUAGE.get(language, "omnivoice-en")


def resolve_voice_instruct(voice: str) -> Optional[str]:
    return VOICE_TO_INSTRUCT.get(voice)


def _audio_to_wav_bytes(audio: Any, sample_rate: int) -> bytes:
    if isinstance(audio, (list, tuple)):
        if not audio:
            raise RuntimeError("OmniVoice returned no audio")
        audio = audio[0]
    audio_np = np.asarray(audio, dtype=np.float32).reshape(-1)
    if audio_np.size == 0:
        raise RuntimeError("OmniVoice returned empty audio")

    buffer = io.BytesIO()
    sf.write(buffer, np.clip(audio_np, -1.0, 1.0), sample_rate, format="WAV")
    return buffer.getvalue()


def synthesize_wav(
    text: str,
    language: str = "ru",
    speed: Optional[float] = None,
    voice: Optional[str] = None,
) -> Tuple[bytes, int]:
    model = _load_model()
    normalized_language = normalize_lang(language)
    normalized_speed = normalize_speed(speed)
    resolved_voice = resolve_voice(voice, normalized_language)
    instruct = resolve_voice_instruct(resolved_voice)
    sample_rate = int(getattr(model, "sampling_rate", _sample_rate) or _sample_rate)

    last_error: Optional[Exception] = None
    for attempt in range(1, OMNIVOICE_SYNTHESIS_ATTEMPTS + 1):
        try:
            with _GENERATION_LOCK:
                audio = model.generate(
                    text=text,
                    language=normalized_language,
                    instruct=instruct,
                    speed=normalized_speed,
                    num_step=OMNIVOICE_NUM_STEP,
                )
            return _audio_to_wav_bytes(audio, sample_rate), sample_rate
        except Exception as error:
            last_error = error
            logger.warning(
                "OmniVoice generation attempt %s/%s failed for language=%s: %s",
                attempt,
                OMNIVOICE_SYNTHESIS_ATTEMPTS,
                normalized_language,
                error,
            )

    raise RuntimeError(
        f"OmniVoice generation failed after {OMNIVOICE_SYNTHESIS_ATTEMPTS} attempt(s): {last_error}"
    ) from last_error


def estimate_duration_ms(wav_bytes: bytes) -> int:
    with sf.SoundFile(io.BytesIO(wav_bytes)) as audio:
        if audio.samplerate <= 0:
            return 0
        return int((len(audio) / audio.samplerate) * 1000)


@app.on_event("startup")
async def preload_model_on_startup():
    if not PRELOAD_MODEL_ON_STARTUP:
        logger.info("TTS model preload is disabled by TTS_PRELOAD_ON_STARTUP=0")
        return
    try:
        await run_in_threadpool(_load_model)
    except Exception as error:
        logger.error("Startup preload failed: %s", error)


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "realtime-tts",
        "provider": "omnivoice",
        "model_id": OMNIVOICE_MODEL_ID,
        "model_loaded": _omnivoice_model is not None,
        "device": _model_device,
        "dtype": str(_model_dtype),
        "sample_rate": _sample_rate,
        "default_speed": DEFAULT_TTS_SPEED,
        "num_step": OMNIVOICE_NUM_STEP,
        "synthesis_attempts": OMNIVOICE_SYNTHESIS_ATTEMPTS,
        "supported_languages": sorted(list(SUPPORTED_LANGUAGES)),
        "voices_total": len(VOICE_INFOS),
        "voice_designs": sorted(VOICE_TO_INSTRUCT.keys()),
    }


@app.get("/voices", response_model=List[VoiceInfo])
async def get_voices():
    return VOICE_INFOS


@app.post("/synthesize", response_model=TTSResponse)
async def synthesize(request: TTSRequest):
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")
    if len(request.text) > 2000:
        raise HTTPException(status_code=400, detail="Text too long (maximum 2000 characters)")

    language = normalize_lang(request.language)
    voice = resolve_voice(request.voice, language)

    try:
        wav_bytes, actual_sample_rate = await run_in_threadpool(
            synthesize_wav,
            request.text.strip(),
            language,
            request.speed,
            voice,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        logger.exception("Synthesis failed: %s", error)
        raise HTTPException(status_code=503, detail=f"Synthesis is temporarily unavailable: {error}")

    duration_ms = estimate_duration_ms(wav_bytes)
    return TTSResponse(
        audio_base64=base64.b64encode(wav_bytes).decode("utf-8"),
        format="wav",
        sample_rate=actual_sample_rate,
        duration_ms=duration_ms,
    )


@app.post("/synthesize/stream")
async def synthesize_stream(request: TTSRequest):
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")

    language = normalize_lang(request.language)
    voice = resolve_voice(request.voice, language)
    try:
        wav_bytes, _ = await run_in_threadpool(
            synthesize_wav,
            request.text.strip(),
            language,
            request.speed,
            voice,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        logger.exception("Stream synthesis failed: %s", error)
        raise HTTPException(status_code=503, detail=f"Synthesis is temporarily unavailable: {error}")

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "Content-Disposition": "attachment; filename=speech.wav",
            "Content-Length": str(len(wav_bytes)),
        },
    )


@app.post("/synthesize/pcm-stream")
async def synthesize_pcm_stream(request: TTSRequest):
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")

    language = normalize_lang(request.language)
    voice = resolve_voice(request.voice, language)
    try:
        wav_bytes, sample_rate = await run_in_threadpool(
            synthesize_wav,
            request.text.strip(),
            language,
            request.speed,
            voice,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        logger.exception("PCM synthesis failed: %s", error)
        raise HTTPException(status_code=503, detail=f"Synthesis is temporarily unavailable: {error}")

    def iter_pcm():
        audio, sr = sf.read(io.BytesIO(wav_bytes), dtype="float32")
        if sr != sample_rate:
            logger.warning("Unexpected sample rate while streaming PCM: %s != %s", sr, sample_rate)
        audio_np = np.asarray(audio, dtype=np.float32).reshape(-1)
        pcm = (np.clip(audio_np, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes()
        chunk_size = 4096
        for offset in range(0, len(pcm), chunk_size):
            yield pcm[offset : offset + chunk_size]

    return StreamingResponse(
        iter_pcm(),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": "attachment; filename=speech.pcm",
            "X-Audio-Codec": "pcm_s16le",
            "X-Audio-Sample-Rate": str(sample_rate),
            "X-Audio-Channels": "1",
        },
    )


@app.get("/")
async def root():
    return {
        "service": "Ollamify Realtime TTS",
        "provider": "omnivoice",
        "model_id": OMNIVOICE_MODEL_ID,
        "version": "4.0.0",
        "default_speed": DEFAULT_TTS_SPEED,
        "num_step": OMNIVOICE_NUM_STEP,
        "voice_designs": sorted(VOICE_TO_INSTRUCT.keys()),
        "languages": sorted(list(SUPPORTED_LANGUAGES)),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8006)
