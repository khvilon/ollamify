FROM qdrant/qdrant:latest

# Открываем порты для API
EXPOSE 6333 6334

# Создаем директорию для данных
VOLUME ["/qdrant/storage"]

# Запускаем Qdrant
CMD ["./qdrant"] 