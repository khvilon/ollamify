# Аутентификация

[English](authentication.md) | **Русский**

Ollamify использует единый gateway (`www3` / Nginx) и проверяет авторизацию для большинства эндпоинтов `/api/*`.

Всегда передавайте:

```
Authorization: Bearer <TOKEN>
```

Где `<TOKEN>` — это либо:
- **JWT** (логин через web UI), либо
- **API key** (для внешних интеграций)

## JWT (web UI)

1) Логин:

- `POST /auth/login`
- body:

```json
{ "email": "admin@example.com", "password": "admin" }
```

- ответ:

```json
{ "token": "..." }
```

2) Использование:

```
Authorization: Bearer <token>
```

## API key (внешние интеграции)

API‑ключи создаются в web UI:

- Users → API keys → Create

Дальше используйте ключ так же, как токен:

```
Authorization: Bearer <api_key>
```

> Внешняя документация (генерируется Zeus): `http://localhost/api/docs`

