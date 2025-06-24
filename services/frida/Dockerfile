FROM python:3.10-slim

WORKDIR /app

# Установка необходимых пакетов
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg2 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Установка зависимостей с поддержкой CUDA 12.8 для RTX 5070 Ti
RUN pip install --no-cache-dir torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
RUN pip install --no-cache-dir sentence-transformers flask gunicorn

# Копирование кода приложения
COPY app.py /app/

# Создание директории для кеширования моделей
RUN mkdir -p /app/models
ENV TRANSFORMERS_CACHE="/app/models"

# Порт для Flask приложения
EXPOSE 8002

# Запуск приложения
CMD ["gunicorn", "--bind", "0.0.0.0:8002", "app:app"] 