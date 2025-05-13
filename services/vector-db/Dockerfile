FROM python:3.10

# Скачиваем Qdrant и копируем его в нужное место
RUN wget https://github.com/qdrant/qdrant/releases/download/v1.7.3/qdrant-x86_64-unknown-linux-gnu.tar.gz && \
    tar -xzf qdrant-x86_64-unknown-linux-gnu.tar.gz && \
    mv qdrant /usr/local/bin/ && \
    rm qdrant-x86_64-unknown-linux-gnu.tar.gz

# Устанавливаем python пакеты
RUN pip install --no-cache-dir torch sentence-transformers

# Создаем директорию для конфигурации и данных
RUN mkdir -p /qdrant/config /qdrant/storage

# Открываем порты для API
EXPOSE 6333 6334

# Копируем конфигурацию
COPY config.yaml /qdrant/config/production.yaml

# Создаем директорию для данных
VOLUME ["/qdrant/storage"]

# Устанавливаем рабочую директорию
WORKDIR /qdrant

# Запускаем Qdrant
CMD ["/usr/local/bin/qdrant"] 