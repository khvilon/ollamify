# Login

**Language:** **English** | [Русский](login.ru.md)

The login page is available at `http://localhost/login`.

## What it does

- Sends credentials to `POST /auth/login`
- Stores the returned token in `localStorage` under `token`
- Redirects you to **Documents** (`/documents`)

## Default credentials (dev)

- Email: `admin@example.com`
- Password: `admin`

## Tips

- If you already have a valid token in `localStorage`, the UI will redirect to `/documents` automatically.
- To “hard logout”, use the menu → **Logout** (clears `localStorage.token`).

