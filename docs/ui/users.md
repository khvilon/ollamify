# Users & API keys

**Language:** **English** | [Русский](users.ru.md)

Path in UI: `/users`

## Purpose

- Manage users (create/edit/delete)
- Manage **API keys** for users (create/copy/delete)

API keys are used for external integrations and can be sent as:

```
Authorization: Bearer <API_KEY>
```

## Users table

Shows:

- Email
- Role (Admin/User)
- Created date
- Actions:
  - **API Keys**
  - **Edit**
  - **Delete**

## Create a user

1) Click **Add User**
2) Fill:
   - Email
   - Password
   - Role (`user` / `admin`)
3) Click **Save**

## Edit a user

- Password can be left blank to keep the current password.

## API keys dialog

1) Click the **key** icon for a user
2) Create a key:
   - set name
   - click **Create**
3) Copy the key value (copy icon)
4) Delete keys if needed

> Keep API keys secret — they grant access as that user.

