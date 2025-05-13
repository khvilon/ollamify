from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer
import torch
import time
import logging
import os
import requests
from requests.adapters import HTTPAdapter, Retry
from huggingface_hub import snapshot_download, HfApi
import threading

# Настраиваем логирование
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s %(levelname)s: %(message)s',
                   datefmt='%Y-%m-%d %H:%M:%S')
logger = logging.getLogger(__name__)

# Определяем устройство (GPU или CPU)
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
logger.info(f"Using device: {device}")

# Увеличиваем таймауты для загрузки моделей
os.environ["HF_HUB_DOWNLOAD_TIMEOUT"] = "600"  # 10 минут для загрузки файлов
os.environ["TRANSFORMERS_HTTP_TIMEOUT"] = "600"  # 10 минут для HTTP запросов

# Настраиваем повторные попытки для HTTP запросов
session = requests.Session()
retries = Retry(total=5, 
                backoff_factor=1,
                status_forcelist=[429, 500, 502, 503, 504],
                allowed_methods=["GET", "POST"])
session.mount('https://', HTTPAdapter(max_retries=retries))
session.mount('http://', HTTPAdapter(max_retries=retries))

app = Flask(__name__)

# Переменная для хранения модели (ленивая инициализация)
model = None
model_loading = False
model_error = None

def load_model_thread():
    """Загрузка модели в отдельном потоке"""
    global model, model_loading, model_error
    try:
        logger.info("Начинаю загрузку модели FRIDA...")
        start_time = time.time()
        
        # Скачиваем модель с проверкой локального кеша
        cache_dir = os.environ.get("TRANSFORMERS_CACHE", "/app/models")
        logger.info(f"Используем кеш-директорию: {cache_dir}")
        
        # Предварительно скачиваем модель снэпшотом для надежности
        try:
            snapshot_download(
                "ai-forever/FRIDA",
                local_dir=f"{cache_dir}/ai-forever/FRIDA",
                cache_dir=cache_dir,
                local_dir_use_symlinks=False,
                resume_download=True
            )
            logger.info("Модель успешно загружена через snapshot_download")
        except Exception as e:
            logger.warning(f"Ошибка при загрузке через snapshot: {str(e)}, продолжаем через SentenceTransformer")
        
        # Загружаем через SentenceTransformer, используя правильное устройство
        model = SentenceTransformer("ai-forever/FRIDA", cache_folder=cache_dir, device=device)
        
        logger.info(f"Модель FRIDA загружена за {time.time() - start_time:.2f} сек на устройстве {device}")
        model_loading = False
        model_error = None
    except Exception as e:
        logger.error(f"Ошибка при загрузке модели FRIDA: {str(e)}")
        model_loading = False
        model_error = str(e)

def get_model():
    """Ленивая инициализация модели с обработкой ошибок"""
    global model, model_loading, model_error
    
    # Если модель уже загружена, возвращаем её
    if model is not None:
        return model
    
    # Если загрузка уже идет, ждем
    if model_loading:
        raise Exception("Модель сейчас загружается, попробуйте запрос позже")
    
    # Если была ошибка, сообщаем о ней
    if model_error is not None:
        raise Exception(f"Ошибка при загрузке модели: {model_error}")
    
    # Запускаем загрузку в отдельном потоке
    model_loading = True
    threading.Thread(target=load_model_thread).start()
    
    # Возвращаем ошибку о том, что загрузка началась
    raise Exception("Первая загрузка модели началась, попробуйте запрос через несколько минут")

@app.route('/health', methods=['GET'])
def health():
    """Эндпоинт для проверки работоспособности сервиса"""
    status = {
        "status": "ok",
        "model_loaded": model is not None,
        "model_loading": model_loading,
        "model_error": model_error
    }
    return jsonify(status)

@app.route('/embed', methods=['POST'])
def embed():
    """Создание эмбеддингов с помощью FRIDA"""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No input data provided"}), 400
        
        texts = data.get('texts', [])
        if isinstance(texts, str):
            texts = [texts]
        
        prompt_name = data.get('prompt_name', 'search_document')
        
        # Добавляем префикс, если не указан
        processed_texts = []
        for text in texts:
            if not any(text.startswith(prefix) for prefix in ["search_query:", "search_document:", "paraphrase:", "categorize:", "categorize_sentiment:", "categorize_topic:", "categorize_entailment:"]):
                text = f"{prompt_name}: {text}"
            processed_texts.append(text)
        
        logger.info(f"Создание эмбеддингов для {len(processed_texts)} текстов с prompt_name={prompt_name}")
        
        # Получаем модель и создаем эмбеддинги
        try:
            current_model = get_model()
            embeddings = current_model.encode(processed_texts)
        except Exception as e:
            # Если модель загружается первый раз, возвращаем заглушку
            if model_loading:
                return jsonify({
                    "error": "Модель загружается, попробуйте позже",
                    "loading": True
                }), 503
            else:
                raise e
        
        # Преобразуем в список, если это один элемент
        if len(processed_texts) == 1:
            embeddings = embeddings.reshape(1, -1)
        
        logger.info(f"Созданы эмбеддинги размерности {embeddings.shape}")
        
        # Преобразуем тензоры PyTorch в списки Python
        embeddings_list = embeddings.tolist()
        
        return jsonify({
            "embeddings": embeddings_list,
            "dimension": embeddings.shape[1]
        })
    
    except Exception as e:
        logger.error(f"Ошибка при создании эмбеддингов: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/info', methods=['GET'])
def model_info():
    """Получение информации о модели"""
    return jsonify({
        "model": "FRIDA",
        "provider": "AI-Forever",
        "description": "Best embedding model for Russian language",
        "dimension": 768,
        "tags": ["russian", "multilingual", "embedding"],
        "status": {
            "loaded": model is not None,
            "loading": model_loading,
            "error": model_error
        }
    })

@app.route('/load', methods=['GET'])
def start_load_model():
    """Запускает загрузку модели в фоне"""
    global model, model_loading, model_error
    
    if model is not None:
        return jsonify({"status": "Model already loaded"})
    
    if model_loading:
        return jsonify({"status": "Model loading already in progress"})
    
    # Сбрасываем ошибку и запускаем загрузку
    model_error = None
    model_loading = True
    threading.Thread(target=load_model_thread).start()
    
    return jsonify({"status": "Model loading started"})

# Запускаем загрузку модели сразу при запуске сервиса
if __name__ != '__main__':
    # Запускаем предзагрузку только при запуске через gunicorn
    threading.Thread(target=load_model_thread).start()

if __name__ == '__main__':
    # Для локальной разработки
    app.run(host='0.0.0.0', port=8002, debug=True) 