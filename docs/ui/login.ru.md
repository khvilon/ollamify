# Login

[English](login.md) | **Русский**

Страница логина доступна по адресу `http://localhost/login`.

## Что делает

- Отправляет учётные данные на `POST /auth/login`
- Сохраняет токен в `localStorage` под ключом `token`
- Перенаправляет на **Documents** (`/documents`)

## Дефолтные учётные данные (dev)

- Email: `admin@example.com`
- Password: `admin`

## Подсказки

- Если в `localStorage` уже есть токен, UI автоматически редиректит на `/documents`.
- Для выхода используйте меню → **Logout** (очищает `localStorage.token`).

