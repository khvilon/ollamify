FROM pytorch/pytorch:2.7.1-cuda12.8-cudnn9-runtime

WORKDIR /app

# Установка необходимых пакетов
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg2 \
    git \
    && rm -rf /var/lib/apt/lists/*

# Проверяем PyTorch из базового CUDA 12.8 образа и ставим зависимости сервиса.
# Важно: `--isolated` игнорирует pip-конфиги/ENV, которые могут добавлять `pypi.nvidia.com` и ломать сборку в некоторых сетях.
ARG PIP_EXTRA_INDEX_URL=https://pypi.org/simple
ARG PIP_TIMEOUT=120
ARG PIP_RETRIES=10
RUN python -c "import torch, torchaudio, torchvision; print(torch.__version__)" && \
    python -m pip install --no-cache-dir --isolated sentence-transformers flask gunicorn \
        --index-url ${PIP_EXTRA_INDEX_URL} \
        --timeout ${PIP_TIMEOUT} --retries ${PIP_RETRIES}

RUN python -m pip install --no-cache-dir --isolated requests \
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
