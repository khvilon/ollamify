import os
import time
import torch
import numpy as np
import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from transformers import AutoModelForSequenceClassification, AutoTokenizer

# Настраиваем логирование
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("jina-reranker")

# Фиксированное имя модели
MODEL_NAME = "jinaai/jina-reranker-v2-base-multilingual"

# Создаем FastAPI приложение
app = FastAPI(
    title="Jina Multilingual Reranker API",
    description="API для переранжирования результатов поиска с использованием Jina Multilingual Reranker v2",
    version="1.0.0"
)

# Проверяем наличие CUDA
logger.info(f"PyTorch version: {torch.__version__}")
logger.info(f"CUDA available: {torch.cuda.is_available()}")
logger.info(f"CUDA device count: {torch.cuda.device_count()}")
if torch.cuda.is_available():
    cuda_device = "cuda:0"
    logger.info(f"CUDA device name: {torch.cuda.get_device_name(0)}")
    device = cuda_device
else:
    device = "cpu"
logger.info(f"Using device: {device}")

# Модели данных
class Document(BaseModel):
    content: str
    filename: str
    similarity: float
    project: Optional[str] = None
    
class RerankerRequest(BaseModel):
    query: str
    documents: List[Document]

class RerankerResponse(BaseModel):
    reranked_documents: List[Document]

# Функция для загрузки модели Jina Reranker
def load_jina_reranker(use_flash_attn=True):
    """Загружает модель Jina Reranker"""
    try:
        logger.info(f"Loading model: {MODEL_NAME}")
        
        # Параметры загрузки
        model_kwargs = {
            "torch_dtype": torch.float16 if torch.cuda.is_available() else torch.float32,
            "trust_remote_code": True
        }
        
        # Добавляем параметр flash attention, если доступен
        if use_flash_attn and torch.cuda.is_available():
            try:
                import flash_attn
                logger.info("Flash attention is available and will be used")
                model_kwargs["use_flash_attn"] = True
            except ImportError:
                logger.warning("Flash attention not available. Continuing without it.")
                model_kwargs["use_flash_attn"] = False
                
        # Загружаем модель и токенизатор
        tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)
        model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, **model_kwargs)
        
        # Переносим модель на нужное устройство с fallback на CPU
        try:
            model.to(device)
            logger.info(f"Successfully loaded model on {device}")
        except RuntimeError as gpu_error:
            if "out of memory" in str(gpu_error).lower():
                logger.warning(f"GPU out of memory, falling back to CPU: {gpu_error}")
                global device
                device = "cpu"
                model.to(device)
                logger.info(f"Successfully loaded model on CPU as fallback")
            else:
                raise gpu_error
                
        model.eval()
        
        logger.info(f"Successfully loaded Jina Reranker model on {device}")
        return model, tokenizer
    except Exception as e:
        logger.error(f"Error loading model: {str(e)}")
        raise RuntimeError(f"Failed to load Jina Reranker model: {str(e)}")

# Загружаем модель
model, tokenizer = load_jina_reranker()

# Маршруты
@app.get("/")
def read_root():
    """Проверка работоспособности сервиса"""
    return {
        "status": "healthy", 
        "model": MODEL_NAME,
        "model_type": "normal",
        "requested_model": MODEL_NAME,
        "device": device,
        "model_source": "Default fixed model",
        "model_env_value": os.environ.get("RERANKER_MODEL", MODEL_NAME),
        "cuda_available": str(torch.cuda.is_available()),
        "cuda_device_count": torch.cuda.device_count()
    }

@app.get("/health")
def health_check():
    """Эндпоинт для проверки работоспособности сервиса (для совместимости с Zeus)"""
    return read_root()

@app.post("/rerank", response_model=RerankerResponse)
async def rerank_documents(request: RerankerRequest):
    """
    Переранжирование документов с использованием Jina Reranker v2 Base Multilingual
    
    Принимает запрос, содержащий вопрос и список документов.
    Возвращает переранжированный список документов.
    """
    start_time = time.time()
    
    try:
        # Логируем запрос
        logger.info(f"Reranking request with query: {request.query[:50]}..." if len(request.query) > 50 else f"Reranking request with query: {request.query}")
        logger.info(f"Documents to rerank: {len(request.documents)}")
        
        # Подготавливаем пары (вопрос, документ) для ранжирования
        pairs = [(request.query, doc.content) for doc in request.documents]
        
        # Если нет документов, сразу возвращаем пустой список
        if len(pairs) == 0:
            return {"reranked_documents": []}
        
        # Получаем скоры
        with torch.no_grad():
            # Используем стандартный метод для reranker
            max_length = 1024  # Максимальная длина входных данных для Jina Reranker
            inputs = tokenizer(pairs, padding=True, truncation=True, return_tensors='pt', max_length=max_length).to(device)
            
            # Получаем скоры
            scores = model(**inputs).logits.view(-1).float().cpu().numpy()
            
            # Для Jina Reranker применяем сигмоиду к скорам (согласно документации модели)
            normalized_scores = 1 / (1 + np.exp(-np.array(scores)))
            
            logger.info(f"Raw scores range: min={scores.min()}, max={scores.max()}")
            logger.info(f"Normalized scores range: min={normalized_scores.min()}, max={normalized_scores.max()}")
        
        # Создаем копию документов для переранжирования
        ranked_docs = []
        for i, doc in enumerate(request.documents):
            # Создаем новый объект документа с обновленной схожестью
            ranked_doc = Document(
                content=doc.content,
                filename=doc.filename,
                similarity=float(normalized_scores[i]),
                project=doc.project
            )
            ranked_docs.append(ranked_doc)
        
        # Сортируем документы по скору (по убыванию)
        ranked_docs.sort(key=lambda x: x.similarity, reverse=True)
        
        # Логируем результаты
        processing_time = time.time() - start_time
        logger.info(f"Reranking completed in {processing_time:.2f}s. Top score: {ranked_docs[0].similarity if ranked_docs else 'N/A'}")
        
        # Возвращаем результат
        return {"reranked_documents": ranked_docs}
        
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"Error in reranking: {str(e)}. Processing time: {processing_time:.2f}s")
        raise HTTPException(status_code=500, detail=f"Error in reranking: {str(e)}")

# Добавляем поддержку метода compute_score (доступна в оригинальной модели)
@app.post("/compute_score")
async def compute_score(request: dict):
    """
    Рассчитывает скоры релевантности для пар (вопрос, документ)
    
    Принимает запрос с полями:
    - sentence_pairs: список пар [вопрос, документ]
    - max_length: максимальная длина входа (по умолчанию 1024)
    
    Возвращает скоры релевантности для каждой пары.
    """
    start_time = time.time()
    
    try:
        sentence_pairs = request.get("sentence_pairs", [])
        max_length = request.get("max_length", 1024)
        
        if not sentence_pairs:
            return {"scores": []}
        
        logger.info(f"Computing scores for {len(sentence_pairs)} sentence pairs")
        
        # Получаем скоры с помощью модели
        with torch.no_grad():
            inputs = tokenizer(sentence_pairs, padding=True, truncation=True, 
                              return_tensors='pt', max_length=max_length).to(device)
            scores = model(**inputs).logits.view(-1).float().cpu().numpy()
            
            # Применяем сигмоиду для нормализации (следуя документации)
            normalized_scores = 1 / (1 + np.exp(-np.array(scores)))
        
        # Логируем результаты
        processing_time = time.time() - start_time
        logger.info(f"Score computation completed in {processing_time:.2f}s")
        
        # Возвращаем результат
        return {"scores": normalized_scores.tolist()}
    
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"Error in compute_score: {str(e)}. Processing time: {processing_time:.2f}s")
        raise HTTPException(status_code=500, detail=f"Error in compute_score: {str(e)}")

# Добавляем метод rerank (аналогичный методу из документации)
@app.post("/rerank_raw")
async def rerank_raw(request: dict):
    """
    Переранжирует список документов на основе запроса
    
    Принимает запрос с полями:
    - query: поисковый запрос
    - documents: список документов
    - max_query_length: максимальная длина запроса (по умолчанию 512)
    - max_length: максимальная длина входа (по умолчанию 1024)
    - top_n: количество возвращаемых документов (по умолчанию все)
    
    Возвращает переранжированные документы со скорами.
    """
    start_time = time.time()
    
    try:
        query = request.get("query", "")
        documents = request.get("documents", [])
        max_query_length = request.get("max_query_length", 512)
        max_length = request.get("max_length", 1024)
        top_n = request.get("top_n")
        
        if not query or not documents:
            return {"results": []}
        
        logger.info(f"Reranking raw request with query: {query[:50]}..." if len(query) > 50 else f"Reranking raw request with query: {query}")
        logger.info(f"Documents to rerank: {len(documents)}")
        
        # Подготавливаем пары (вопрос, документ)
        pairs = [[query, doc] for doc in documents]
        
        # Получаем скоры с помощью модели
        with torch.no_grad():
            inputs = tokenizer(pairs, padding=True, truncation=True, 
                             return_tensors='pt', max_length=max_length).to(device)
            scores = model(**inputs).logits.view(-1).float().cpu().numpy()
            
            # Применяем сигмоиду для нормализации
            normalized_scores = 1 / (1 + np.exp(-np.array(scores)))
        
        # Создаем результаты
        results = []
        for i, doc in enumerate(documents):
            results.append({
                "corpus_id": i,
                "score": float(normalized_scores[i]),
                "text": doc
            })
        
        # Сортируем результаты по скору
        results.sort(key=lambda x: x["score"], reverse=True)
        
        # Ограничиваем количество результатов, если указано
        if top_n is not None:
            results = results[:top_n]
        
        # Логируем результаты
        processing_time = time.time() - start_time
        logger.info(f"Raw reranking completed in {processing_time:.2f}s. Results: {len(results)}")
        
        # Возвращаем результат
        return {"results": results}
    
    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"Error in rerank_raw: {str(e)}. Processing time: {processing_time:.2f}s")
        raise HTTPException(status_code=500, detail=f"Error in rerank_raw: {str(e)}")

# Запускаем приложение, если файл запущен напрямую
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run("app:app", host="0.0.0.0", port=port) 