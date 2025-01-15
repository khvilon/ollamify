# Ollamify

Платформа для управления документами и моделями с использованием Ollama для эмбеддингов и семантического поиска.

## Архитектура

Проект состоит из нескольких микросервисов:

### Zeus Service (порт 3004)
- Node.js + Express
- Обработка документов и моделей
- Создание эмбеддингов через Ollama
- Семантический поиск
- API для работы с документами и моделями

### Auth Service (порт 3003)
- Node.js + Express
- JWT аутентификация
- Управление пользователями
- Безопасное хранение паролей с bcrypt

### Frontend (www3) (порт 80)
- React (без сборщика)
- Material UI для компонентов
- Модульная структура компонентов
- Nginx для проксирования запросов
- Защищенные роуты с авторизацией
- Единая точка входа для всех сервисов

#### Структура компонентов фронтенда:
- `Login.js` - Страница входа
- `Documents.js` - Управление документами
- `Models.js` - Управление моделями Ollama
- `Users.js` - Управление пользователями
- `Profile.js` - Профиль пользователя
- `Layout.js` - Общий layout для авторизованных страниц

### Ollama Service (порт 11434)
- Сервис для работы с LLM моделями
- Создание эмбеддингов
- GPU акселерация

### Vector Database (порт 5432)
- PostgreSQL с pgvector
- Хранение документов и эмбеддингов
- Векторный поиск

## Конфигурация

### Переменные окружения (.env)
```env
# Database Configuration
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=ollamify
POSTGRES_HOST=vector-db
POSTGRES_PORT=5432

# Auth Configuration
JWT_SECRET=your-super-secret-key-change-in-production
AUTH_PORT=3003

# Zeus Configuration
ZEUS_PORT=3004

# Nginx Configuration
NGINX_PORT=80
```

## Маршрутизация и авторизация

### Публичные маршруты:
- `/login` - Страница входа

### Защищенные маршруты (требуют авторизации):
- `/documents` - Управление документами
- `/models` - Управление моделями
- `/users` - Управление пользователями
- `/profile` - Профиль пользователя

### Авторизация:
- Использует JWT токены
- Токен хранится в localStorage
- Автоматический редирект на /login при отсутствии токена
- Компонент Layout оборачивает только защищенные маршруты

## База данных

### Основные таблицы

#### users
- id: UUID PRIMARY KEY
- email: VARCHAR(255) UNIQUE
- password_hash: VARCHAR(255)
- role: VARCHAR(50)
- created_at: TIMESTAMP
- updated_at: TIMESTAMP

#### documents
- id: UUID PRIMARY KEY
- title: VARCHAR(255)
- content: TEXT
- embedding: vector(384)
- user_id: UUID REFERENCES users(id)
- created_at: TIMESTAMP
- updated_at: TIMESTAMP

#### models
- id: UUID PRIMARY KEY
- name: VARCHAR(255)
- description: TEXT
- model_path: VARCHAR(255)
- parameters: JSONB
- created_at: TIMESTAMP
- updated_at: TIMESTAMP

## API Endpoints

### Auth API
- POST /auth/login - Аутентификация
- POST /auth/register - Регистрация
- GET /auth/verify - Проверка токена
- GET /auth/profile - Информация о пользователе

### Documents API
- GET /api/documents - Список документов
- POST /api/documents - Создание документа
- GET /api/documents/:id - Получение документа
- PUT /api/documents/:id - Обновление документа
- DELETE /api/documents/:id - Удаление документа
- POST /api/documents/search - Семантический поиск

### Models API
- GET /api/models - Список моделей
- POST /api/models - Создание модели
- GET /api/models/:id - Получение модели
- PUT /api/models/:id - Обновление модели
- DELETE /api/models/:id - Удаление модели
- POST /api/models/pull - Загрузка модели из репозитория

### Users API
- GET /api/users - Список пользователей
- POST /api/users - Создание пользователя
- GET /api/users/:id - Получение пользователя
- PUT /api/users/:id - Обновление пользователя
- DELETE /api/users/:id - Удаление пользователя
