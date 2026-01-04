FROM python:3.10-slim

WORKDIR /app

# Установка необходимых пакетов
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg2 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Установка зависимостей с поддержкой CUDA 12.8 для RTX 5070 Ti
# Важно: `--isolated` игнорирует pip-конфиги/ENV, которые могут добавлять `pypi.nvidia.com` и ломать сборку в некоторых сетях.
ARG PYTORCH_INDEX_URL=https://download.pytorch.org/whl/cu128
ARG PIP_EXTRA_INDEX_URL=https://pypi.org/simple
ARG PIP_TIMEOUT=120
ARG PIP_RETRIES=10
RUN python -m pip install --no-cache-dir --isolated --upgrade pip \
        --index-url ${PIP_EXTRA_INDEX_URL} \
        --timeout ${PIP_TIMEOUT} --retries ${PIP_RETRIES} && \
    python -m pip install --no-cache-dir --isolated \
        torch==2.7.1+cu128 torchvision==0.22.1+cu128 torchaudio==2.7.1+cu128 \
        --index-url ${PYTORCH_INDEX_URL} \
        --extra-index-url ${PIP_EXTRA_INDEX_URL} \
        --timeout ${PIP_TIMEOUT} --retries ${PIP_RETRIES} && \
    python -m pip install --no-cache-dir --isolated sentence-transformers flask gunicorn \
        --index-url ${PIP_EXTRA_INDEX_URL} \
        --timeout ${PIP_TIMEOUT} --retries ${PIP_RETRIES}

# Копирование кода приложения
COPY app.py /app/

# Создание директории для кеширования моделей
RUN mkdir -p /app/models
ENV TRANSFORMERS_CACHE="/app/models"

# Порт для Flask приложения
EXPOSE 8002

# Запуск приложения
CMD ["gunicorn", "--bind", "0.0.0.0:8002", "app:app"] 