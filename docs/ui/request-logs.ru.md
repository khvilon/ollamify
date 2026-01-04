# Request Logs

[English](request-logs.md) | **Русский**

Путь в UI: `/request-logs`

## Назначение

Просмотр истории запросов для мониторинга и отладки:

- какие эндпоинты вызываются
- время ответа / медленные запросы
- какая модель использовалась (если есть)

Страница использует:
- `GET /api/admin/logs` (для не‑админов доступен ограниченный вид)

## Фильтры

- Метод (GET/POST/PUT/DELETE)
- Path contains
- Диапазон дат/времени

Только для админов:

- Фильтр по пользователю
- Просмотр IP
- Просмотр request/response body в деталях
- Таблица “User Stats” (`/api/admin/stats/users`)

## Диалог деталей

Кнопка **Details** показывает:

- method, path, category
- model name
- response time
- user text (если сохранялся)
- request/response body (только админ)

