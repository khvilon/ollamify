FROM pytorch/pytorch:2.5.0-cuda12.4-cudnn9-runtime

WORKDIR /app

# Обновляем систему и устанавливаем необходимые пакеты
RUN apt-get update && apt-get install -y \
    git \
    curl \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Копируем файлы зависимостей
COPY requirements.txt .

# Обновляем PyTorch (CUDA 12.8).
# Важно: `--isolated` игнорирует pip-конфиги/ENV, которые могут добавлять `pypi.nvidia.com` и ломать сборку в некоторых сетях.
ARG PYTORCH_INDEX_URL=https://download.pytorch.org/whl/cu128
ARG PIP_EXTRA_INDEX_URL=https://pypi.org/simple
ARG PIP_TIMEOUT=120
ARG PIP_RETRIES=10
RUN python -m pip install --no-cache-dir --isolated --upgrade torch torchvision torchaudio \
    --index-url ${PYTORCH_INDEX_URL} \
    --extra-index-url ${PIP_EXTRA_INDEX_URL} \
    --timeout ${PIP_TIMEOUT} --retries ${PIP_RETRIES}

# Устанавливаем Python зависимости
RUN python -m pip install --no-cache-dir --isolated -r requirements.txt \
    --index-url ${PIP_EXTRA_INDEX_URL} \
    --timeout ${PIP_TIMEOUT} --retries ${PIP_RETRIES}

# Создаем директорию для кеша моделей
RUN mkdir -p /app/models

# Копируем исходный код
COPY app.py .

# Настраиваем переменные окружения
ENV TORCH_HOME=/app/models
ENV HF_HOME=/app/models
ENV TRANSFORMERS_CACHE=/app/models

# Открываем порт
EXPOSE 8003

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8003/health || exit 1

# Запуск приложения
CMD ["python", "app.py"] 