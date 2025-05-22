from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import torch
import io
import base64
import logging
import time
import os
from fastapi.responses import Response
import threading
import numpy as np
import soundfile as sf
import wave

# Настраиваем логирование
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s %(levelname)s: %(message)s',
                   datefmt='%Y-%m-%d %H:%M:%S')
logger = logging.getLogger(__name__)

# Проверяем доступность CUDA
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
logger.info(f"Using device: {device}")

app = FastAPI(
    title="Ollamify TTS Service",
    description="Text-to-Speech service with Silero TTS",
    version="2.0.0"
)

# Модели данных
class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "aidar"      # aidar, baya, kseniya, xenia
    speed: Optional[float] = 1.0        # 0.5 - 2.0
    sample_rate: Optional[int] = 24000  # 8000, 24000, 48000
    format: Optional[str] = "wav"       # wav
    language: Optional[str] = "ru"      # ru

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

# Глобальные переменные для модели
model = None
model_loading = False
model_error = None

# Доступные голоса Silero
available_voices = [
    {"name": "aidar", "gender": "male", "language": "ru", "description": "Мужской голос Айдар (Silero)"},
    {"name": "baya", "gender": "female", "language": "ru", "description": "Женский голос Бая (Silero)"},
    {"name": "kseniya", "gender": "female", "language": "ru", "description": "Женский голос Ксения (Silero)"},
    {"name": "xenia", "gender": "female", "language": "ru", "description": "Женский голос Ксения 2 (Silero)"}
]

def load_silero_model():
    """Загрузка модели Silero TTS"""
    global model, model_loading, model_error
    
    try:
        model_loading = True
        logger.info("Загрузка Silero TTS модели...")
        
        # Загружаем модель Silero
        model, utils = torch.hub.load(
            repo_or_dir='snakers4/silero-models',
            model='silero_tts',
            language='ru',
            speaker='v3_1_ru'
        )
        
        model.to(device)
        
        logger.info(f"Silero TTS модель загружена на {device}")
        model_loading = False
        model_error = None
        
    except Exception as e:
        logger.error(f"Ошибка загрузки Silero модели: {str(e)}")
        model_error = str(e)
        model_loading = False
        model = None

def get_model():
    """Получение модели"""
    global model
    if model is None and not model_loading:
        load_silero_model()
    return model

@app.get("/health")
def health_check():
    """Проверка состояния сервиса"""
    return {
        "status": "healthy" if model is not None else "loading" if model_loading else "error",
        "model_loaded": model is not None,
        "model_loading": model_loading,
        "model_error": model_error,
        "device": str(device),
        "cuda_available": torch.cuda.is_available(),
        "torch_version": torch.__version__,
        "model_type": "Silero TTS v3.1",
        "license": "GPL 3.0 (Non-commercial use)",
        "language": "Russian",
        "voices": len(available_voices)
    }

@app.get("/voices", response_model=List[VoiceInfo])
def get_voices():
    """Получение списка доступных голосов"""
    return available_voices

@app.post("/synthesize", response_model=TTSResponse)
async def synthesize_speech(request: TTSRequest):
    """Синтез речи из текста с Silero TTS"""
    try:
        start_time = time.time()
        
        # Проверяем модель
        current_model = get_model()
        if current_model is None:
            if model_loading:
                raise HTTPException(status_code=503, detail="Модель загружается, попробуйте позже")
            else:
                raise HTTPException(status_code=503, detail=f"Модель не загружена: {model_error}")
        
        # Валидация параметров
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="Пустой текст")
        
        if len(request.text) > 1000:
            raise HTTPException(status_code=400, detail="Текст слишком длинный (максимум 1000 символов)")
        
        if request.voice not in [v["name"] for v in available_voices]:
            raise HTTPException(status_code=400, detail=f"Неизвестный голос: {request.voice}")
        
        if not (0.5 <= request.speed <= 2.0):
            raise HTTPException(status_code=400, detail="Скорость должна быть от 0.5 до 2.0")
        
        if request.sample_rate not in [8000, 24000, 48000]:
            raise HTTPException(status_code=400, detail="Поддерживаемые частоты: 8000, 24000, 48000 Hz")
        
        logger.info(f"Silero TTS синтез: '{request.text[:50]}...' голосом {request.voice}")
        
        # Синтез с Silero
        with torch.no_grad():
            audio = current_model.apply_tts(
                text=request.text,
                speaker=request.voice,
                sample_rate=request.sample_rate,
                put_accent=True,
                put_yo=True
            )
        
        # Применяем изменение скорости
        if request.speed != 1.0:
            # Изменяем скорость через ресэмплинг
            target_length = int(len(audio) / request.speed)
            if target_length > 0:
                indices = torch.linspace(0, len(audio) - 1, target_length).long()
                audio = audio[indices]
        
        # Конвертируем в numpy
        audio_np = audio.cpu().numpy()
        
        # Конвертируем в WAV формат
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as wav_file:
            wav_file.setnchannels(1)  # моно
            wav_file.setsampwidth(2)  # 16 бит
            wav_file.setframerate(request.sample_rate)
            
            # Конвертируем float в int16
            audio_int16 = (audio_np * 32767).astype(np.int16)
            wav_file.writeframes(audio_int16.tobytes())
        
        audio_bytes = buffer.getvalue()
        
        # Кодируем в base64
        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
        
        # Вычисляем продолжительность
        duration_ms = int(len(audio_np) / request.sample_rate * 1000)
        
        processing_time = time.time() - start_time
        logger.info(f"Silero TTS завершен за {processing_time:.2f}с, длительность: {duration_ms}мс")
        
        return TTSResponse(
            audio_base64=audio_base64,
            format=request.format,
            sample_rate=request.sample_rate,
            duration_ms=duration_ms
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Ошибка синтеза: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Ошибка синтеза: {str(e)}")

@app.post("/synthesize/stream")
async def synthesize_speech_stream(request: TTSRequest):
    """Синтез речи с возвратом аудио потока"""
    try:
        logger.info(f"Silero TTS поток: '{request.text[:50]}...'")
        
        # Проверяем модель
        current_model = get_model()
        if current_model is None:
            raise HTTPException(status_code=503, detail="Модель не загружена")
        
        # Синтез с Silero
        with torch.no_grad():
            audio = current_model.apply_tts(
                text=request.text,
                speaker=request.voice,
                sample_rate=request.sample_rate,
                put_accent=True,
                put_yo=True
            )
        
        # Конвертируем в numpy
        audio_np = audio.cpu().numpy()
        
        # Конвертируем в WAV формат
        buffer = io.BytesIO()
        with wave.open(buffer, 'wb') as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(request.sample_rate)
            audio_int16 = (audio_np * 32767).astype(np.int16)
            wav_file.writeframes(audio_int16.tobytes())
        
        audio_bytes = buffer.getvalue()
        
        return Response(
            content=audio_bytes,
            media_type="audio/wav",
            headers={
                "Content-Disposition": "attachment; filename=speech.wav",
                "Content-Length": str(len(audio_bytes))
            }
        )
        
    except Exception as e:
        logger.error(f"Ошибка потокового синтеза: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
def root():
    """Информация о сервисе"""
    return {
        "service": "Ollamify TTS (Silero)",
        "version": "2.0.0",
        "model": "Silero TTS v3.1",
        "license": "GPL 3.0 (Non-commercial use)",
        "language": "Russian",
        "available_voices": len(available_voices),
        "device": str(device),
        "features": ["russian_tts", "neural_synthesis", "high_quality"],
        "voices": [v["name"] for v in available_voices]
    }

@app.on_event("startup")
async def startup_event():
    """Инициализация при запуске"""
    logger.info("Запуск Silero TTS сервиса...")
    # Загружаем модель в фоновом режиме
    threading.Thread(target=load_silero_model, daemon=True).start()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8003) 