import os
import time
import torch
import numpy as np
import subprocess
import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional, Tuple, Union

# Настраиваем логирование
logging.basicConfig(level=logging.INFO, 
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("reranker")

# Создаем FastAPI приложение
app = FastAPI(
    title="Reranker API",
    description="API для переранжирования результатов поиска с использованием различных моделей Reranker",
    version="1.0.0"
)

# Загружаем модель из переменной окружения или используем значение по умолчанию
reranker_model = os.environ.get('RERANKER_MODEL', 'BAAI/bge-reranker-v2-m3')
logger.info(f"Requested reranker model: {reranker_model}")
logger.info(f"Model source: {'Environment variable RERANKER_MODEL' if 'RERANKER_MODEL' in os.environ else 'Default fallback value'}")

# Функция для определения и установки зависимостей для конкретной модели
def install_model_dependencies(model_name):
    """Устанавливает необходимые зависимости для конкретной модели"""
    logger.info(f"Checking dependencies for model: {model_name}")
    
    # Базовые зависимости, которые всегда полезны
    base_deps = ["sentencepiece", "protobuf", "accelerate", "einops"]
    special_deps = []
    
    model_name_lower = model_name.lower()
    
    # Определяем специальные зависимости на основе модели
    if any(name in model_name_lower for name in ["qwen", "mixtral", "gemma", "mistral"]):
        special_deps.append("transformers[sentencepiece]")
    
    if "llama" in model_name_lower:
        special_deps.append("transformers[sentencepiece]")
    
    if "cohere" in model_name_lower:
        special_deps.extend(["cohere", "tokenizers>=0.15.0"])
    
    if "e5" in model_name_lower or "e5-instruct" in model_name_lower:
        special_deps.append("transformers[sentencepiece]")
    
    if "gpt" in model_name_lower or "openai" in model_name_lower:
        special_deps.append("tiktoken")
    
    if "mxbai" in model_name_lower:
        special_deps.extend(["transformers>=4.37.0", "tokenizers>=0.15.0"])
    
    # Устанавливаем все нужные зависимости
    if special_deps:
        deps_str = " ".join(special_deps)
        logger.info(f"Installing special dependencies for {model_name}: {deps_str}")
        try:
            subprocess.check_call(f"pip install --no-cache-dir {deps_str}", shell=True)
            logger.info(f"Successfully installed special dependencies for {model_name}")
        except subprocess.CalledProcessError as e:
            logger.error(f"Failed to install special dependencies: {str(e)}")
    
    # Устанавливаем базовые зависимости
    deps_str = " ".join(base_deps)
    logger.info(f"Installing base dependencies: {deps_str}")
    try:
        subprocess.check_call(f"pip install --no-cache-dir {deps_str}", shell=True)
        logger.info("Successfully installed base dependencies")
    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to install base dependencies: {str(e)}")

# Устанавливаем зависимости для модели
install_model_dependencies(reranker_model)

# Инициализируем модель и токенизатор
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

# Импортируем трансформеры только после установки зависимостей
try:
    from transformers import (
        AutoModelForSequenceClassification, 
        AutoTokenizer, 
        AutoModelForCausalLM
    )
except ImportError:
    logger.error("Failed to import transformers. Trying to install...")
    subprocess.check_call("pip install --no-cache-dir transformers", shell=True)
    from transformers import (
        AutoModelForSequenceClassification, 
        AutoTokenizer, 
        AutoModelForCausalLM
    )

# Определяем тип модели на основе имени
def determine_model_type(model_name):
    """Определяет тип модели (обычный реранкер или LLM-based) на основе имени"""
    model_name_lower = model_name.lower()
    
    if "gemma" in model_name_lower:
        return "llm_gemma"
    elif "minicpm" in model_name_lower:
        if "layerwise" in model_name_lower:
            return "llm_layerwise"
        return "llm_minicpm"
    elif "llama" in model_name_lower or "mixtral" in model_name_lower or "qwen" in model_name_lower:
        return "llm_general"
    else:
        return "normal"

# Для LLM-based реранкеров - функция подготовки входных данных
def get_llm_inputs(pairs, tokenizer, max_length=1024):
    """Подготавливает входные данные для LLM-based реранкеров"""
    prompt = "Given a query A and a passage B, determine whether the passage contains an answer to the query by providing a prediction of either 'Yes' or 'No'."
    sep = "\n"
    prompt_inputs = tokenizer(prompt,
                            return_tensors=None,
                            add_special_tokens=False)['input_ids']
    sep_inputs = tokenizer(sep,
                           return_tensors=None,
                           add_special_tokens=False)['input_ids']
    inputs = []
    for query, passage in pairs:
        query_inputs = tokenizer(f'A: {query}',
                                return_tensors=None,
                                add_special_tokens=False,
                                max_length=max_length * 3 // 4,
                                truncation=True)
        passage_inputs = tokenizer(f'B: {passage}',
                                   return_tensors=None,
                                   add_special_tokens=False,
                                   max_length=max_length,
                                   truncation=True)
        try:
            # Для большинства токенизаторов
            item = tokenizer.prepare_for_model(
                [tokenizer.bos_token_id] + query_inputs['input_ids'],
                sep_inputs + passage_inputs['input_ids'],
                truncation='only_second',
                max_length=max_length,
                padding=False,
                return_attention_mask=False,
                return_token_type_ids=False,
                add_special_tokens=False
            )
            item['input_ids'] = item['input_ids'] + sep_inputs + prompt_inputs
            item['attention_mask'] = [1] * len(item['input_ids'])
        except:
            # Альтернативный подход, если prepare_for_model не работает
            logger.warning("Using alternative tokenization approach")
            all_ids = ([tokenizer.bos_token_id] + 
                      query_inputs['input_ids'] + 
                      sep_inputs + 
                      passage_inputs['input_ids'] + 
                      sep_inputs + 
                      prompt_inputs)
            if len(all_ids) > max_length:
                all_ids = all_ids[:max_length]
            item = {
                'input_ids': all_ids,
                'attention_mask': [1] * len(all_ids)
            }
        inputs.append(item)
    
    # Паддинг и перевод в тензоры
    return tokenizer.pad(
            inputs,
            padding=True,
            max_length=max_length + len(sep_inputs) + len(prompt_inputs),
            pad_to_multiple_of=8,
            return_tensors='pt',
    )

# Словарь моделей и токенизаторов
tokenizer = None
model = None
model_loaded = None
model_type = None
yes_token_id = None

# Функция для загрузки модели с несколькими попытками и проверками
def load_reranker_model(model_name, num_attempts=3):
    """Загружает модель реранкера с несколькими попытками"""
    global tokenizer, model, model_loaded, model_type, yes_token_id
    
    # Определяем тип модели
    model_type = determine_model_type(model_name)
    logger.info(f"Determined model type: {model_type}")
    
    # Параметры загрузки моделей
    model_kwargs = {}
    tokenizer_kwargs = {"trust_remote_code": True}
    
    # Особые случаи для некоторых моделей
    if any(x in model_type for x in ["llm_gemma", "llm_minicpm", "llm_layerwise", "llm_general"]):
        model_kwargs["torch_dtype"] = torch.float16 if torch.cuda.is_available() else torch.float32
    elif "mxbai" in model_name.lower() or ("intfloat" in model_name.lower() and "e5" in model_name.lower()):
        model_kwargs["torch_dtype"] = torch.float16 if torch.cuda.is_available() else torch.float32
    
    for attempt in range(num_attempts):
        try:
            logger.info(f"Loading model (attempt {attempt+1}/{num_attempts}): {model_name}")
            
            # Выбираем правильную загрузку в зависимости от типа модели
            if model_type.startswith("llm_"):
                # LLM-based реранкер
                tokenizer = AutoTokenizer.from_pretrained(model_name, **tokenizer_kwargs)
                model = AutoModelForCausalLM.from_pretrained(model_name, **model_kwargs)
                
                # Для LLM-реранкеров нужен ID токена "Yes"
                try:
                    yes_token_id = tokenizer('Yes', add_special_tokens=False)['input_ids'][0]
                    logger.info(f"Yes token ID: {yes_token_id}")
                except:
                    # Если не удалось получить ID, используем значение по умолчанию
                    yes_token_id = 1176  # Типичный ID для "Yes" в некоторых моделях
                    logger.warning(f"Using default Yes token ID: {yes_token_id}")
            else:
                # Обычный реранкер
                tokenizer = AutoTokenizer.from_pretrained(model_name, **tokenizer_kwargs)
                model = AutoModelForSequenceClassification.from_pretrained(model_name, **model_kwargs)
            
            # Общие настройки для всех моделей
            model.to(device)
            model.eval()
            model_loaded = model_name
            logger.info(f"Successfully loaded model: {model_name}")
            return True
        except Exception as e:
            logger.error(f"Error loading model (attempt {attempt+1}/{num_attempts}): {str(e)}")
            if attempt < num_attempts - 1:
                logger.info(f"Retrying with different parameters...")
                # Изменим параметры загрузки для следующей попытки
                tokenizer_kwargs["trust_remote_code"] = not tokenizer_kwargs.get("trust_remote_code", True)
                if "torch_dtype" in model_kwargs:
                    model_kwargs.pop("torch_dtype")
                else:
                    model_kwargs["torch_dtype"] = torch.float16 if torch.cuda.is_available() else torch.float32
            else:
                return False

# Попытка загрузить модель с несколькими вариациями и фолбэками
fallback_models = [
    reranker_model,
    "BAAI/bge-reranker-large", 
    "BAAI/bge-reranker-v2-m3",
    "cross-encoder/ms-marco-MiniLM-L-6-v2"
]

model_loaded = None
for model_name in fallback_models:
    if load_reranker_model(model_name):
        model_loaded = model_name
        break

if model_loaded is None:
    raise RuntimeError("Failed to load any reranker model after trying all fallbacks")

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
    
# Нормализация оценок в диапазон [0,1]
def normalize_scores(scores, min_score=-10, max_score=0):
    """Нормализует оценки в диапазон [0,1]"""
    if len(scores) == 0:
        return []
    
    # Применяем сигмоиду для LLM-моделей
    if model_type.startswith("llm_"):
        return 1 / (1 + np.exp(-np.array(scores)))
    
    # Для обычных моделей - линейная нормализация с ограничениями
    return np.clip((np.array(scores) - min_score) / (max_score - min_score), 0, 1)
    
# Маршруты
@app.get("/")
def read_root():
    """Проверка работоспособности сервиса"""
    return {
        "status": "healthy", 
        "model": model_loaded,
        "model_type": model_type,
        "requested_model": reranker_model,
        "device": device,
        "model_source": "Environment variable RERANKER_MODEL" if "RERANKER_MODEL" in os.environ else "Default fallback value",
        "model_env_value": os.environ.get("RERANKER_MODEL", "Not set"),
        "cuda_available": str(torch.cuda.is_available()),
        "cuda_device_count": torch.cuda.device_count()
    }

@app.post("/rerank", response_model=RerankerResponse)
async def rerank_documents(request: RerankerRequest):
    """
    Переранжирование документов с использованием модели Reranker
    
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
            
        # Получаем скоры в зависимости от типа модели
        with torch.no_grad():
            if model_type.startswith("llm_"):
                # LLM-based реранкер
                logger.info(f"Using LLM-based reranker workflow for model type: {model_type}")
                inputs = get_llm_inputs(pairs, tokenizer).to(device)
                
                # Получаем оценки от модели
                outputs = model(**inputs, return_dict=True)
                
                # Извлекаем оценки в зависимости от типа модели
                if model_type == "llm_layerwise":
                    # Для layerwise моделей особая логика
                    all_scores = outputs[0]
                    scores = all_scores[0][:, -1, yes_token_id].view(-1).float().cpu().numpy()
                else:
                    # Для обычных LLM-моделей
                    scores = outputs.logits[:, -1, yes_token_id].view(-1).float().cpu().numpy()
            else:
                # Обычный реранкер
                logger.info(f"Using standard reranker workflow for model type: {model_type}")
                max_length = 512
                inputs = tokenizer(pairs, padding=True, truncation=True, return_tensors='pt', max_length=max_length).to(device)
                scores = model(**inputs, return_dict=True).logits.view(-1).float().cpu().numpy()
            
            logger.info(f"Raw scores range: min={scores.min()}, max={scores.max()}")
            
            # Нормализуем оценки
            normalized_scores = normalize_scores(scores)
            logger.info(f"Normalized scores range: min={normalized_scores.min()}, max={normalized_scores.max()}")
        
        # Создаем копию документов для переранжирования
        ranked_docs = []
        for i, doc in enumerate(request.documents):
            # Создаем новый объект документа с обновленной схожестью
            ranked_doc = Document(
                content=doc.content,
                filename=doc.filename,
                similarity=float(normalized_scores[i]),  # Используем нормализованные оценки
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

# Запускаем приложение, если файл запущен напрямую
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run("app:app", host="0.0.0.0", port=port) 