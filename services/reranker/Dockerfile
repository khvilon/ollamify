FROM python:3.10-slim

WORKDIR /app

# Устанавливаем зависимости для трансформеров
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Устанавливаем необходимые библиотеки
COPY services/reranker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Создаем директорию для кеша моделей
RUN mkdir -p /app/models
ENV TRANSFORMERS_CACHE=/app/models

# Устанавливаем переменные окружения
ENV PORT=8001
ENV RERANKER_MODEL=qilowoq/bge-reranker-v2-m3-en-ru

# Копируем приложение
COPY services/reranker/app.py .

# Открываем порт
EXPOSE 8001

# Запускаем приложение
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"] 