# Request Logs

**Language:** **English** | [Русский](request-logs.ru.md)

Path in UI: `/request-logs`

## Purpose

Inspect request history for troubleshooting and monitoring:

- which endpoints are called
- response time / slow requests
- which model was used (if available)

This page uses:
- `GET /api/admin/logs` (also available to non-admins in a limited form)

## Filters

- Method (GET/POST/PUT/DELETE)
- Path contains
- Start/end datetime

Admin-only:

- Filter by User
- See IP addresses
- See request/response bodies in details
- “User Stats” table (`/api/admin/stats/users`)

## Details dialog

Click **Details** to see:

- method, path, category
- model name
- response time
- user text (if captured)
- request/response bodies (admin only)

