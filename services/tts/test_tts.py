#!/usr/bin/env python3
"""
Тестовый скрипт для TTS API на базе Silero TTS
Использование: python test_tts.py

Модель: Silero TTS (см. /health для информации о лицензии, как она задана в сервисе)
"""

import requests
import base64
import wave
import time
from pathlib import Path

# URL TTS сервиса
TTS_URL = "http://localhost:8003"

def test_health():
    """Тест работоспособности сервиса"""
    print("🔍 Проверка состояния TTS сервиса (Silero TTS)...")
    try:
        response = requests.get(f"{TTS_URL}/health", timeout=10)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Сервис работает")
            print(f"   Модель: {data.get('model_type', 'неизвестно')}")
            print(f"   Лицензия: {data.get('license', 'неизвестно')}")
            print(f"   Модель загружена: {data.get('model_loaded', False)}")
            print(f"   Устройство: {data.get('device', 'неизвестно')}")
            print(f"   CUDA доступна: {data.get('cuda_available', False)}")
            return True
        else:
            print(f"❌ Сервис недоступен: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Ошибка подключения: {e}")
        return False

def test_voices():
    """Тест получения списка голосов"""
    print("\n🎤 Получение списка голосов Silero TTS...")
    try:
        response = requests.get(f"{TTS_URL}/voices", timeout=10)
        if response.status_code == 200:
            voices = response.json()
            print(f"✅ Доступно голосов: {len(voices)}")
            for voice in voices:
                print(f"   - {voice['name']} ({voice['gender']}, {voice['language']}): {voice['description']}")
            return voices
        else:
            print(f"❌ Ошибка получения голосов: {response.status_code}")
            return []
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return []

def test_synthesis(voice="aidar", text="Привет! Это тест синтеза речи с помощью Silero TTS.", language="ru"):
    """Тест синтеза речи"""
    print(f"\n🗣️ Тест синтеза речи голосом '{voice}' на языке '{language}'...")
    print(f"   Текст: '{text}'")
    
    try:
        payload = {
            "text": text,
            "voice": voice,
            "speed": 1.0,
            "sample_rate": 24000,
            "format": "wav",
            "language": language
        }
        
        start_time = time.time()
        response = requests.post(f"{TTS_URL}/synthesize", json=payload, timeout=60)
        synthesis_time = time.time() - start_time
        
        if response.status_code == 200:
            data = response.json()
            audio_data = base64.b64decode(data['audio_base64'])
            
            # Сохраняем аудио файл
            output_dir = Path("test_output")
            output_dir.mkdir(exist_ok=True)
            
            filename = f"test_silero_{voice}_{language}_{int(time.time())}.wav"
            filepath = output_dir / filename
            
            with open(filepath, 'wb') as f:
                f.write(audio_data)
            
            print(f"✅ Синтез успешен")
            print(f"   Время синтеза: {synthesis_time:.2f}с")
            print(f"   Длительность аудио: {data['duration_ms']}мс")
            print(f"   Частота: {data['sample_rate']}Hz")
            print(f"   Файл сохранен: {filepath}")
            print(f"   Размер файла: {len(audio_data)} байт")
            
            # Проверяем RTF (Real Time Factor)
            audio_duration_sec = data['duration_ms'] / 1000
            rtf = synthesis_time / audio_duration_sec if audio_duration_sec > 0 else 0
            print(f"   RTF (Real Time Factor): {rtf:.2f} ({'быстрее' if rtf < 1 else 'медленнее'} реального времени)")
            
            return True
        else:
            error_data = response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text
            print(f"❌ Ошибка синтеза: {response.status_code}")
            print(f"   Детали: {error_data}")
            return False
            
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return False

def test_stream_synthesis(voice="male_1", text="Это тест потокового синтеза речи с помощью ИКСТТС.", language="ru"):
    """Тест потокового синтеза"""
    print(f"\n🌊 Тест потокового синтеза голосом '{voice}'...")
    
    try:
        payload = {
            "text": text,
            "voice": voice,
            "speed": 1.2,
            "sample_rate": 24000,
            "language": language
        }
        
        start_time = time.time()
        response = requests.post(f"{TTS_URL}/synthesize/stream", json=payload, timeout=60)
        synthesis_time = time.time() - start_time
        
        if response.status_code == 200:
            # Сохраняем потоковый ответ
            output_dir = Path("test_output")
            output_dir.mkdir(exist_ok=True)
            
            filename = f"stream_silero_{voice}_{int(time.time())}.wav"
            filepath = output_dir / filename
            
            with open(filepath, 'wb') as f:
                f.write(response.content)
            
            print(f"✅ Потоковый синтез успешен")
            print(f"   Время синтеза: {synthesis_time:.2f}с")
            print(f"   Файл сохранен: {filepath}")
            print(f"   Размер файла: {len(response.content)} байт")
            
            return True
        else:
            print(f"❌ Ошибка потокового синтеза: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return False

def test_different_voices():
    """Тест разных голосов Silero TTS"""
    print("\n🎭 Тест всех доступных голосов Silero TTS...")
    
    voices_to_test = ["aidar", "baya", "kseniya", "xenia"]
    
    for voice in voices_to_test:
        text = f"Привет! Меня зовут {voice}, это тест голоса Silero TTS."
        
        test_synthesis(voice, text)
        time.sleep(2)  # Пауза между тестами

def test_language_note():
    """Пояснение по языкам"""
    print("\n🌍 Языки: текущая реализация TTS в проекте ориентирована на RU (Silero).")

def test_speed_variations():
    """Тест разных скоростей"""
    print("\n⚡ Тест различных скоростей (Silero TTS)...")
    
    speeds = [0.5, 0.8, 1.0, 1.5, 2.0]
    
    for speed in speeds:
        print(f"\n   Тест скорости {speed}x...")
        payload = {
            "text": f"Тест скорости речи {speed} раза от нормальной (Silero TTS).",
            "voice": "aidar",
            "speed": speed,
            "sample_rate": 24000,
            "language": "ru"
        }
        
        try:
            response = requests.post(f"{TTS_URL}/synthesize", json=payload, timeout=60)
            if response.status_code == 200:
                print(f"   ✅ Скорость {speed}x работает")
            else:
                print(f"   ❌ Ошибка для скорости {speed}x")
        except Exception as e:
            print(f"   ❌ Ошибка: {e}")

def test_service_info():
    """Проверка общей информации о сервисе"""
    print("\nℹ️ Информация о сервисе...")
    
    try:
        response = requests.get(f"{TTS_URL}/", timeout=10)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Модель: {data.get('model', 'неизвестно')}")
            print(f"✅ Лицензия: {data.get('license', 'неизвестно')}")
            print(f"✅ Возможности: {', '.join(data.get('features', []))}")
            return True
        else:
            print(f"❌ Не удалось получить информацию: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return False

def main():
    """Основная функция тестирования"""
    print("🚀 Запуск тестов Silero TTS API")
    print("=" * 60)
    
    # Проверяем доступность сервиса
    if not test_health():
        print("\n❌ Сервис недоступен, тесты прерваны")
        return
    
    # Проверяем общую информацию о сервисе
    test_service_info()
    
    # Получаем список голосов
    voices = test_voices()
    
    if not voices:
        print("\n❌ Не удалось получить список голосов")
        return
    
    # Основные тесты
    test_synthesis()
    test_stream_synthesis(voice="baya", text="Это тест потокового синтеза речи (Silero TTS).")
    test_different_voices()
    test_language_note()
    test_speed_variations()
    
    print("\n" + "=" * 60)
    print("✅ Все тесты завершены!")
    print("📁 Аудио файлы сохранены в папке 'test_output'")
    print("ℹ️ См. /health для информации о лицензии (как она задана в сервисе).")

if __name__ == "__main__":
    main() 