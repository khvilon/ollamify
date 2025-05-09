FROM python:3.10-slim

WORKDIR /app

# Устанавливаем зависимости для трансформеров
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Устанавливаем необходимые библиотеки
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Устанавливаем дополнительные зависимости для различных моделей
RUN pip install --no-cache-dir \
    "transformers[sentencepiece,onnx]>=4.36.0" \
    "huggingface-hub>=0.19.0" \
    accelerate>=0.25.0 \
    einops>=0.7.0 \
    tiktoken>=0.5.0 \
    safetensors>=0.4.0

# Создаем директорию для кеша моделей и устанавливаем права
RUN mkdir -p /app/models && chmod 777 /app/models
ENV TRANSFORMERS_CACHE=/app/models
# Разрешаем всем пользователям писать в папку site-packages
RUN chmod -R 777 /usr/local/lib/python3.10/site-packages

# Устанавливаем переменные окружения
ENV PORT=8001
ENV RERANKER_MODEL=${RERANKER_MODEL}
# Настраиваем переменные для трансформеров
ENV TOKENIZERS_PARALLELISM=true
ENV HF_HUB_ENABLE_HF_TRANSFER=1

# Копируем код приложения
COPY app.py .

# Открываем порт
EXPOSE 8001

# Запускаем приложение
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"] 