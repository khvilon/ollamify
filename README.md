# Ollamify - Локальная RAG платформа с Voice Assistant

Ollamify - это полнофункциональная локальная платформа для работы с документами, использующая технологии RAG (Retrieval-Augmented Generation) и интегрированный голосовой помощник.

## 🚀 Быстрый старт

### CPU режим (по умолчанию)
```bash
docker-compose up -d
```

### GPU режим (для NVIDIA GPU)
```bash
docker-compose -f docker-compose.gpu.yml up -d
```

**Различия режимов:**
- **CPU**: Базовый режим, все модели работают на CPU
- **GPU**: Ускоренный режим с поддержкой NVIDIA GPU для TTS, Ollama, Frida и Reranker

## 📊 Архитектура системы

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Interface │    │   Voice Assistant│    │   API Gateway   │
│   (www3:80)     │    │   (TTS/STT)     │    │   (zeus:80)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Auth Service  │    │   Vector DB     │    │   PostgreSQL    │
│   (auth:80)     │    │   (qdrant:6333) │    │   (db:5432)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                 │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Ollama LLM    │    │   Reranker      │    │   TTS Service   │
│   (ollama:11434)│    │   (reranker:8001│    │   (tts:8003)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │   Frida Service │
                    │   (frida:8002)  │
                    └─────────────────┘
```

## 🎙️ Voice Assistant

Система включает полнофункциональный голосовой помощник с поддержкой:

### TTS (Text-to-Speech) - Silero TTS
- **Модель**: Silero TTS v3.1 
- **Лицензия**: GPL 3.0 (некоммерческое использование)
- **Язык**: Русский
- **Голоса**: 4 высококачественных русских голоса
  - `aidar` - мужской голос Айдар
  - `baya` - женский голос Бая  
  - `kseniya` - женский голос Ксения
  - `xenia` - женский голос Ксения 2

### Функции Voice Assistant
- ✅ **Синтез речи (TTS)** - готов к использованию
- 🔄 **Распознавание речи (STT)** - в разработке
- 🔄 **Клонирование голоса** - планируется

### Доступ к Voice Assistant
1. Откройте http://localhost в браузере
2. Войдите в систему (admin@example.com / admin123)
3. Перейдите в раздел "Voice Assistant"

## 🛠 Технологический стек

### Основные сервисы
- **Frontend**: Vanilla JS + Material Design Icons
- **Backend API**: Node.js + Express
- **Аутентификация**: FastAPI + JWT
- **База данных**: PostgreSQL + pgvector
- **Векторная БД**: Qdrant
- **Языковая модель**: Ollama (локально)
- **Веб-сервер**: Nginx

### AI/ML компоненты
- **TTS**: Silero TTS v3.1 (русские голоса)
- **Reranker**: Модели для улучшения поиска
- **Frida**: Дополнительные AI функции
- **Embedding**: Локальные векторные представления

## 📋 Системные требования

### Минимальные требования (CPU режим)
- **RAM**: 8 GB
- **Диск**: 20 GB свободного места
- **CPU**: 4 ядра
- **Docker**: 20.10+ и Docker Compose v2

### Рекомендуемые требования (GPU режим)  
- **RAM**: 16 GB
- **Диск**: 50 GB свободного места
- **GPU**: NVIDIA с 8 GB+ VRAM
- **CUDA**: 11.8+
- **Docker**: с поддержкой NVIDIA Container Toolkit

## 🔧 Настройка

### Переменные окружения
Скопируйте `.env_example` в `.env` и настройте:

```bash
cp .env_example .env
```

Основные настройки:
```env
# Database
POSTGRES_DB=ollamify
POSTGRES_USER=ollamify_user
POSTGRES_PASSWORD=your_secure_password

# JWT
JWT_SECRET=your_jwt_secret_key

# Models
# Embedding model is now configured per project in the web interface
RERANKER_MODEL=ms-marco-MiniLM-L-12-v2
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
```

## 📖 Использование

### Базовые функции
1. **Загрузка документов**: Поддержка PDF, TXT, DOCX
2. **Поиск**: Векторный и гибридный поиск
3. **Чат с документами**: RAG с локальными LLM
4. **Голосовой интерфейс**: TTS синтез речи

### API Endpoints

#### TTS API
```bash
# Список голосов
GET /api/tts/voices

# Синтез речи
POST /api/tts/synthesize
{
  "text": "Привет! Это тест системы синтеза речи.",
  "voice": "aidar",
  "speed": 1.0,
  "sample_rate": 24000
}
```

#### Документы API
```bash
# Загрузка документа
POST /api/documents/upload

# Поиск в документах
POST /api/documents/search
{
  "query": "ваш поисковый запрос",
  "limit": 10
}
```

#### AI Chat API
```bash
# Чат с документами
POST /api/ai/chat
{
  "message": "Расскажи о содержании документов",
  "context": "документы_контекст"
}
```

## 🔍 Мониторинг и отладка

### Проверка статуса сервисов
```bash
# Статус всех контейнеров
docker-compose ps

# Логи конкретного сервиса
docker-compose logs tts
docker-compose logs zeus
docker-compose logs auth
```

### Health проверки
- **TTS**: http://localhost:8003/health
- **Reranker**: http://localhost:8001/health
- **Frida**: http://localhost:8002/health
- **Vector DB**: http://localhost:6333/health

### Веб-интерфейсы
- **Основное приложение**: http://localhost
- **Qdrant UI**: http://localhost:6333/dashboard
- **API документация**: http://localhost/api-docs

## 🚨 Устранение неполадок

### Частые проблемы

#### TTS не работает
   ```bash
# Проверка статуса
docker logs tts

# Перезапуск TTS
docker-compose restart tts
   ```

#### 404 ошибки API
   ```bash
# Проверка Zeus сервиса
docker logs zeus

# Перезапуск backend
docker-compose restart zeus
```

#### Проблемы с GPU
```bash
# Проверка NVIDIA Docker
docker run --rm --gpus all nvidia/cuda:11.8-base-ubuntu22.04 nvidia-smi

# GPU режим
docker-compose -f docker-compose.gpu.yml up -d
```

### Полная переустановка
```bash
# Остановка и удаление
docker-compose down -v

# Удаление образов
docker-compose down --rmi all

# Чистый запуск
docker-compose up -d
```

## 📚 Дополнительная документация

- [TTS Testing Guide](TTS_TESTING_GUIDE.md) - Подробное тестирование голосового интерфейса
- [TTS Implementation Report](TTS_IMPLEMENTATION_REPORT.md) - Технические детали TTS интеграции

## 🤝 Вклад в проект

1. Fork проекта
2. Создайте feature branch (`git checkout -b feature/amazing-feature`)
3. Commit изменения (`git commit -m 'Add amazing feature'`)
4. Push в branch (`git push origin feature/amazing-feature`)
5. Откройте Pull Request

## 📄 Лицензия

Проект использует различные лицензии для разных компонентов:
- **Основной код**: MIT License
- **Silero TTS**: GPL 3.0 (некоммерческое использование)
- **Другие модели**: См. соответствующие репозитории

## 🔮 Планы развития

- [ ] Интеграция STT (Speech-to-Text)
- [ ] Клонирование голосов
- [ ] Поддержка больше языков для TTS
- [ ] Мобильное приложение
- [ ] Интеграция с внешними LLM API
- [ ] Расширенная аналитика

---

**Ollamify** - локальная, приватная и мощная платформа для работы с документами и голосовым интерфейсом. 