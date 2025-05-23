#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Speech-to-Text (STT) Service
Основан на OpenAI Whisper для распознавания речи
"""

import os
import io
import tempfile
import logging
import torch
from typing import Dict, List, Any, Optional
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flasgger import Swagger
import whisper
import librosa
import soundfile as sf
import numpy as np
from pydub import AudioSegment
import traceback

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Настройка Swagger
app.config['SWAGGER'] = {
    'title': 'Ollamify STT API',
    'description': 'Speech-to-Text service на базе OpenAI Whisper',
    'version': '1.0.0',
    'uiversion': 3
}
swagger = Swagger(app)

# Глобальные переменные
whisper_model = None
device = None
model_name = "base"  # По умолчанию small модель

# Поддерживаемые языки (основные для Whisper)
SUPPORTED_LANGUAGES = {
    'ru': 'Русский',
    'en': 'English', 
    'es': 'Español',
    'fr': 'Français',
    'de': 'Deutsch',
    'it': 'Italiano',
    'pt': 'Português',
    'pl': 'Polski',
    'tr': 'Türkçe',
    'nl': 'Nederlands',
    'cs': 'Čeština',
    'ar': 'العربية',
    'zh': '中文',
    'ja': '日本語',
    'ko': '한국어',
    'uk': 'Українська',
    'hi': 'हिन्दी'
}

# Доступные модели Whisper
WHISPER_MODELS = {
    'tiny': {'size': '39 MB', 'speed': 'очень быстро', 'quality': 'базовое'},
    'base': {'size': '74 MB', 'speed': 'быстро', 'quality': 'хорошее'},
    'small': {'size': '244 MB', 'speed': 'средне', 'quality': 'отличное'},
    'medium': {'size': '769 MB', 'speed': 'медленно', 'quality': 'очень хорошее'},
    'large': {'size': '1550 MB', 'speed': 'очень медленно', 'quality': 'наилучшее'}
}

def load_whisper_model(model_name: str = "base"):
    """Загрузка модели Whisper"""
    global whisper_model, device
    
    try:
        # Определяем устройство
        if torch.cuda.is_available():
            device = "cuda"
            logger.info("Используется GPU для Whisper")
        else:
            device = "cpu"
            logger.info("Используется CPU для Whisper")
        
        logger.info(f"Загружаем модель Whisper: {model_name}")
        logger.info(f"Размер модели: {WHISPER_MODELS.get(model_name, {}).get('size', 'unknown')}")
        
        # Загружаем модель
        whisper_model = whisper.load_model(model_name, device=device, download_root=os.environ.get('WHISPER_CACHE', '/app/models'))
        
        logger.info(f"Модель Whisper {model_name} успешно загружена на {device}")
        
        # Очищаем кеш GPU если нужно
        if device == "cuda":
            torch.cuda.empty_cache()
            
        return True
        
    except Exception as e:
        logger.error(f"Ошибка загрузки модели Whisper: {e}")
        return False

def preprocess_audio(audio_file, target_sr: int = 16000) -> np.ndarray:
    """Предобработка аудио файла"""
    try:
        # Загружаем аудио
        if hasattr(audio_file, 'read'):
            # Если это file-like объект
            audio_data = audio_file.read()
            audio_file.seek(0)  # Сброс позиции
        else:
            audio_data = audio_file
        
        # Конвертируем через pydub для поддержки различных форматов
        audio = AudioSegment.from_file(io.BytesIO(audio_data))
        
        # Конвертируем в моно и нужную частоту
        audio = audio.set_channels(1).set_frame_rate(target_sr)
        
        # Конвертируем в numpy array
        audio_array = np.array(audio.get_array_of_samples(), dtype=np.float32)
        
        # Нормализуем
        if audio.sample_width == 2:  # 16-bit
            audio_array = audio_array / 32768.0
        elif audio.sample_width == 4:  # 32-bit
            audio_array = audio_array / 2147483648.0
        
        return audio_array
        
    except Exception as e:
        logger.error(f"Ошибка предобработки аудио: {e}")
        raise

@app.route('/health', methods=['GET'])
def health_check():
    """
    Проверка состояния сервиса
    ---
    responses:
      200:
        description: Сервис работает
    """
    global whisper_model
    
    # Информация о памяти GPU
    gpu_info = {}
    if torch.cuda.is_available():
        gpu_info = {
            'gpu_available': True,
            'gpu_memory_allocated': f"{torch.cuda.memory_allocated() / 1024**3:.2f} GB",
            'gpu_memory_reserved': f"{torch.cuda.memory_reserved() / 1024**3:.2f} GB",
            'gpu_name': torch.cuda.get_device_name(0) if torch.cuda.device_count() > 0 else 'Unknown'
        }
    else:
        gpu_info = {'gpu_available': False}
    
    return jsonify({
        'status': 'healthy',
        'model_loaded': whisper_model is not None,
        'device': device,
        'model_name': model_name,
        'model_info': WHISPER_MODELS.get(model_name, {}),
        'gpu_info': gpu_info,
        'supported_languages': len(SUPPORTED_LANGUAGES),
        'available_models': list(WHISPER_MODELS.keys())
    })

@app.route('/models', methods=['GET'])
def get_models():
    """
    Получить список доступных моделей
    ---
    responses:
      200:
        description: Список моделей Whisper
    """
    return jsonify({
        'models': WHISPER_MODELS,
        'current_model': model_name,
        'languages': SUPPORTED_LANGUAGES
    })

@app.route('/model/load', methods=['POST'])
def load_model():
    """
    Загрузить указанную модель Whisper
    ---
    parameters:
      - in: body
        name: body
        schema:
          type: object
          properties:
            model_name:
              type: string
              description: Название модели (tiny, base, small, medium, large)
    responses:
      200:
        description: Модель успешно загружена
      400:
        description: Ошибка в параметрах
    """
    try:
        data = request.get_json()
        new_model_name = data.get('model_name', 'base')
        
        if new_model_name not in WHISPER_MODELS:
            return jsonify({'error': f'Неизвестная модель: {new_model_name}'}), 400
        
        global model_name
        model_name = new_model_name
        
        success = load_whisper_model(model_name)
        if success:
            return jsonify({
                'status': 'success',
                'model_name': model_name,
                'device': device
            })
        else:
            return jsonify({'error': 'Не удалось загрузить модель'}), 500
            
    except Exception as e:
        logger.error(f"Ошибка при загрузке модели: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/transcribe', methods=['POST'])
def transcribe_audio():
    """
    Транскрибация аудио файла в текст
    ---
    parameters:
      - in: formData
        name: audio
        type: file
        required: true
        description: Аудио файл для распознавания
      - in: formData
        name: language
        type: string
        description: Код языка (ru, en, etc.)
      - in: formData
        name: task
        type: string
        description: Задача (transcribe или translate)
      - in: formData
        name: model
        type: string
        description: Модель Whisper (tiny, base, small, medium, large)
    responses:
      200:
        description: Успешная транскрибация
      400:
        description: Ошибка в параметрах
      500:
        description: Ошибка сервера
    """
    global whisper_model, model_name
    
    try:
        # Проверяем наличие аудио файла
        if 'audio' not in request.files:
            return jsonify({'error': 'Аудио файл не найден'}), 400
        
        audio_file = request.files['audio']
        if audio_file.filename == '':
            return jsonify({'error': 'Файл не выбран'}), 400
        
        # Получаем параметры
        language = request.form.get('language', None)  # auto-detect если None
        task = request.form.get('task', 'transcribe')  # transcribe или translate
        requested_model = request.form.get('model', None)  # модель для использования
        
        # Проверяем и загружаем нужную модель
        if requested_model:
            if requested_model not in WHISPER_MODELS:
                return jsonify({'error': f'Неизвестная модель: {requested_model}. Доступные: {list(WHISPER_MODELS.keys())}'}), 400
            
            # Если запрошенная модель отличается от загруженной, перегружаем
            if requested_model != model_name or whisper_model is None:
                logger.info(f"Переключение модели с {model_name} на {requested_model}")
                model_name = requested_model
                success = load_whisper_model(model_name)
                if not success:
                    return jsonify({'error': f'Не удалось загрузить модель {requested_model}'}), 500
        else:
            # Если модель не указана, используем текущую загруженную
            if whisper_model is None:
                return jsonify({'error': 'Модель не загружена. Укажите параметр model или загрузите модель через /model/load'}), 500
        
        logger.info(f"Начинаем транскрибацию, модель: {model_name}, язык: {language}, задача: {task}")
        
        # Предобрабатываем аудио
        audio_array = preprocess_audio(audio_file)
        
        # Запускаем Whisper
        options = {
            'task': task,
            'fp16': device == 'cuda'  # Используем fp16 только на GPU
        }
        
        if language and language in SUPPORTED_LANGUAGES:
            options['language'] = language
        
        result = whisper_model.transcribe(audio_array, **options)
        
        # Формируем ответ
        response_data = {
            'text': result['text'].strip(),
            'language': result.get('language', 'unknown'),
            'task': task,
            'model': model_name,
            'segments': []
        }
        
        # Добавляем сегменты если есть
        if 'segments' in result:
            for segment in result['segments']:
                response_data['segments'].append({
                    'start': segment.get('start', 0),
                    'end': segment.get('end', 0),
                    'text': segment.get('text', '').strip()
                })
        
        logger.info(f"Транскрибация завершена: {len(response_data['text'])} символов, модель: {model_name}")
        
        return jsonify(response_data)
        
    except Exception as e:
        logger.error(f"Ошибка транскрибации: {e}")
        logger.error(traceback.format_exc())
        return jsonify({'error': f'Ошибка обработки: {str(e)}'}), 500

@app.route('/transcribe/stream', methods=['POST'])
def transcribe_stream():
    """
    Потоковая транскрибация (пока не реализована)
    ---
    responses:
      501:
        description: Не реализовано
    """
    return jsonify({'error': 'Потоковая транскрибация будет добавлена в следующей версии'}), 501

if __name__ == '__main__':
    # Загружаем модель при старте
    logger.info("Запуск STT сервиса...")
    
    if load_whisper_model(model_name):
        logger.info("STT сервис готов к работе!")
    else:
        logger.error("Не удалось загрузить модель Whisper")
    
    # Запускаем сервер
    port = int(os.environ.get('PORT', 8004))
    app.run(host='0.0.0.0', port=port, debug=False) 