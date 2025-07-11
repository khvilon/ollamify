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

# Обновляем PyTorch до версии с поддержкой RTX 5070 Ti
RUN pip install --no-cache-dir --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128

# Устанавливаем Python зависимости
RUN pip install --no-cache-dir -r requirements.txt

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