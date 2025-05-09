import os
import time
import torch
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from transformers import AutoModelForSequenceClassification, AutoTokenizer

# Создаем FastAPI приложение
app = FastAPI(
    title="Reranker API",
    description="API для переранжирования результатов поиска с использованием модели BGE Reranker",
    version="1.0.0"
)

# Загружаем модель из переменной окружения или используем значение по умолчанию
reranker_model = os.environ.get('RERANKER_MODEL', 'qilowoq/bge-reranker-v2-m3-en-ru')
print(f"Loading reranker model: {reranker_model}")
print(f"Model source: {'Environment variable RERANKER_MODEL' if 'RERANKER_MODEL' in os.environ else 'Default fallback value'}")

# Инициализируем модель и токенизатор
# Проверяем наличие CUDA
print(f"PyTorch version: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
print(f"CUDA device count: {torch.cuda.device_count()}")
if torch.cuda.is_available():
    cuda_device = "cuda:0"
    print(f"CUDA device name: {torch.cuda.get_device_name(0)}")
    device = cuda_device
else:
    device = "cpu"
print(f"Using device: {device}")

# Загружаем модель и токенизатор с обработкой ошибок
try:
    tokenizer = AutoTokenizer.from_pretrained(reranker_model, trust_remote_code=True)
    model = AutoModelForSequenceClassification.from_pretrained(reranker_model, trust_remote_code=True)
    model.to(device)
    model.eval()
    print(f"Successfully loaded model: {reranker_model}")
except Exception as e:
    print(f"Error loading the original model: {str(e)}")
    print("Attempting to load the BAAI model as fallback...")
    try:
        # Используем оригинальную модель BAAI как запасной вариант
        fallback_model = "BAAI/bge-reranker-v2-m3"
        tokenizer = AutoTokenizer.from_pretrained(fallback_model, trust_remote_code=True)
        model = AutoModelForSequenceClassification.from_pretrained(fallback_model, trust_remote_code=True)
        model.to(device)
        model.eval()
        print(f"Successfully loaded fallback model: {fallback_model}")
    except Exception as e2:
        print(f"Error loading fallback model: {str(e2)}")
        raise RuntimeError(f"Failed to load any reranker model. Original error: {str(e)}, Fallback error: {str(e2)}")

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
    
# Маршруты
@app.get("/")
def read_root():
    """Проверка работоспособности сервиса"""
    return {
        "status": "healthy", 
        "model": reranker_model,
        "device": device,
        "model_source": "Environment variable RERANKER_MODEL" if "RERANKER_MODEL" in os.environ else "Default fallback value",
        "model_env_value": os.environ.get("RERANKER_MODEL", "Not set"),
        "cuda_available": str(torch.cuda.is_available()),
        "cuda_device_count": torch.cuda.device_count()
    }

@app.post("/rerank", response_model=RerankerResponse)
async def rerank_documents(request: RerankerRequest):
    """
    Переранжирование документов с использованием BGE Reranker
    
    Принимает запрос, содержащий вопрос и список документов.
    Возвращает переранжированный список документов.
    """
    start_time = time.time()
    
    try:
        # Подготавливаем пары (вопрос, документ) для ранжирования
        pairs = [(request.query, doc.content) for doc in request.documents]
        
        # Если нет документов, сразу возвращаем пустой список
        if len(pairs) == 0:
            return {"reranked_documents": []}
            
        # Получаем скоры для каждой пары
        with torch.no_grad():
            inputs = tokenizer(pairs, padding=True, truncation=True, return_tensors='pt', max_length=512).to(device)
            scores = model(**inputs, return_dict=True).logits.view(-1,).float().cpu().numpy()
        
        # Создаем копию документов для переранжирования
        ranked_docs = []
        for i, doc in enumerate(request.documents):
            # Создаем новый объект документа с обновленной схожестью
            ranked_doc = Document(
                content=doc.content,
                filename=doc.filename,
                similarity=float(scores[i]),  # Используем скор от модели reranker
                project=doc.project
            )
            ranked_docs.append(ranked_doc)
        
        # Сортируем документы по скору (по убыванию)
        ranked_docs.sort(key=lambda x: x.similarity, reverse=True)
        
        # Возвращаем результат
        return {"reranked_documents": ranked_docs}
        
    except Exception as e:
        processing_time = time.time() - start_time
        print(f"Error in reranking: {str(e)}. Processing time: {processing_time:.2f}s")
        raise HTTPException(status_code=500, detail=f"Error in reranking: {str(e)}")

# Запускаем приложение, если файл запущен напрямую
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run("app:app", host="0.0.0.0", port=port) 