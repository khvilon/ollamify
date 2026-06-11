import base64
import io
import logging
import os
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel
from transformers import AutoModel, AutoProcessor


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Ollamify Realtime TTS Service",
    description="Multilingual TTS service (ru/en/he) based on OpenMOSS",
    version="3.0.0",
)


SUPPORTED_LANGUAGES = {"ru", "en", "he"}
VOICE_INFOS = [
    {"name": "moss-ru", "gender": "unknown", "language": "ru", "description": "OpenMOSS Russian"},
    {"name": "moss-en", "gender": "unknown", "language": "en", "description": "OpenMOSS English"},
    {"name": "moss-he", "gender": "unknown", "language": "he", "description": "OpenMOSS Hebrew"},
]
VOICE_TO_LANGUAGE = {item["name"]: item["language"] for item in VOICE_INFOS}
DEFAULT_VOICE_BY_LANGUAGE = {
    "ru": "moss-ru",
    "en": "moss-en",
    "he": "moss-he",
}

MOSS_MODEL_ID = os.environ.get("MOSS_MODEL_ID", "OpenMOSS-Team/MOSS-TTS-Local-Transformer")
MAX_NEW_TOKENS = int(os.environ.get("MOSS_MAX_NEW_TOKENS", "320"))
PRELOAD_MODEL_ON_STARTUP = os.environ.get("TTS_PRELOAD_ON_STARTUP", "1").strip() != "0"

_MODEL_LOCK = Lock()
_moss_model: Optional[Any] = None
_moss_processor: Optional[Any] = None
_model_device = "cpu"
_model_dtype = torch.float32
_sample_rate = 24000


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


def _detect_device() -> str:
    forced = (os.environ.get("MOSS_DEVICE") or "").strip().lower()
    if forced in {"cpu", "cuda"}:
        if forced == "cuda" and not torch.cuda.is_available():
            logger.warning("MOSS_DEVICE=cuda requested, but CUDA is unavailable. Falling back to CPU.")
            return "cpu"
        return forced
    return "cuda" if torch.cuda.is_available() else "cpu"


def _resolve_dtype(device: str) -> torch.dtype:
    if device == "cuda":
        return torch.bfloat16
    return torch.float32


def _ensure_openmoss_config_compat(model: Any) -> None:
    config = getattr(model, "config", None)
    if config is None:
        return
    if hasattr(config, "num_hidden_layers"):
        return

    fallback_layers = (
        getattr(config, "local_num_layers", None)
        or getattr(config, "num_layers", None)
        or getattr(config, "n_layer", None)
    )
    if fallback_layers is None:
        return

    try:
        setattr(config, "num_hidden_layers", int(fallback_layers))
        logger.info("Patched OpenMOSS config: num_hidden_layers=%s", getattr(config, "num_hidden_layers", "unknown"))
    except Exception as error:
        logger.warning("Unable to patch OpenMOSS config compatibility: %s", error)


def _load_model() -> Tuple[Any, Any]:
    global _moss_model, _moss_processor, _model_device, _model_dtype, _sample_rate
    with _MODEL_LOCK:
        if _moss_model is not None and _moss_processor is not None:
            return _moss_model, _moss_processor

        _model_device = _detect_device()
        _model_dtype = _resolve_dtype(_model_device)
        logger.info("Loading OpenMOSS model %s on device: %s (dtype=%s)", MOSS_MODEL_ID, _model_device, _model_dtype)

        processor = AutoProcessor.from_pretrained(MOSS_MODEL_ID, trust_remote_code=True)
        if hasattr(processor, "audio_tokenizer") and hasattr(processor.audio_tokenizer, "to"):
            processor.audio_tokenizer = processor.audio_tokenizer.to(_model_device)

        model = AutoModel.from_pretrained(
            MOSS_MODEL_ID,
            trust_remote_code=True,
            dtype=_model_dtype,
        ).to(_model_device)
        _ensure_openmoss_config_compat(model)
        model.eval()

        try:
            _sample_rate = int(getattr(processor.model_config, "sampling_rate", 24000))
        except Exception:
            _sample_rate = 24000

        _moss_model = model
        _moss_processor = processor
        logger.info("OpenMOSS model loaded successfully")
        return _moss_model, _moss_processor


def resolve_voice(requested_voice: Optional[str], language: str) -> str:
    if requested_voice and requested_voice in VOICE_TO_LANGUAGE:
        return requested_voice
    return DEFAULT_VOICE_BY_LANGUAGE.get(language, "moss-en")


def _decode_audio_from_outputs(processor: Any, outputs: torch.Tensor) -> torch.Tensor:
    messages = processor.decode(outputs)
    if not messages:
        raise RuntimeError("OpenMOSS decode returned no messages")
    audio_codes_list = getattr(messages[0], "audio_codes_list", None)
    if not audio_codes_list:
        raise RuntimeError("OpenMOSS decode returned no audio codes")
    audio = audio_codes_list[0]
    if not isinstance(audio, torch.Tensor):
        audio = torch.tensor(audio, dtype=torch.float32)
    if audio.dim() > 1:
        audio = audio.squeeze()
    return audio.detach().cpu().float().clamp(-1.0, 1.0)


def synthesize_wav(text: str) -> Tuple[bytes, int]:
    model, processor = _load_model()
    # Keep generation bounded; large token budgets can cause very long responses.
    target_tokens = min(500, max(120, len(text) * 4))
    try:
        user_message = processor.build_user_message(text=text, tokens=target_tokens)
    except TypeError:
        user_message = processor.build_user_message(text=text)
    conversation = [[user_message]]
    batch = processor(conversation, mode="generation")
    input_ids = batch["input_ids"].to(_model_device)
    attention_mask = batch.get("attention_mask")
    if attention_mask is not None:
        attention_mask = attention_mask.to(_model_device)

    with torch.no_grad():
        outputs = model.generate(
            input_ids=input_ids,
            attention_mask=attention_mask,
            max_new_tokens=MAX_NEW_TOKENS,
        )

    audio = _decode_audio_from_outputs(processor, outputs)
    audio_np = audio.numpy()
    buffer = io.BytesIO()
    sf.write(buffer, audio_np, _sample_rate, format="WAV")
    return buffer.getvalue(), _sample_rate


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
        "provider": "openmoss",
        "model_id": MOSS_MODEL_ID,
        "model_loaded": _moss_model is not None,
        "device": _model_device,
        "dtype": str(_model_dtype),
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
    _ = voice  # API compatibility; OpenMOSS voice is selected by text/style capabilities.

    try:
        wav_bytes, actual_sample_rate = await run_in_threadpool(synthesize_wav, request.text.strip())
    except Exception as error:
        logger.exception("Synthesis failed: %s", error)
        raise HTTPException(status_code=503, detail=f"Синтез временно недоступен: {error}")

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
        raise HTTPException(status_code=400, detail="Пустой текст")

    try:
        wav_bytes, _ = await run_in_threadpool(synthesize_wav, request.text.strip())
    except Exception as error:
        logger.exception("Stream synthesis failed: %s", error)
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
        "provider": "openmoss",
        "model_id": MOSS_MODEL_ID,
        "version": "3.0.0",
        "languages": sorted(list(SUPPORTED_LANGUAGES)),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8006)
