# UI guide

**Language:** **English** | [Русский](README.ru.md)

This page documents the web interface available at `http://localhost` after you start the stack.

## Navigation

Main pages (left menu):

- Documents
- Projects
- Models
- Chat
- Voice
- API
- Users
- Request Logs
- Profile

## Login

Path: `/login`

### What it does

- Sends credentials to `POST /auth/login`
- Stores the returned token in `localStorage` under `token`
- Redirects you to **Documents** (`/documents`)

### Default credentials (dev)

- Email: `admin@example.com`
- Password: `admin`

### Tips

- If you already have a valid token in `localStorage`, the UI will redirect to `/documents` automatically.
- To “hard logout”, use the menu → **Logout** (clears `localStorage.token`).

## Documents

Path: `/documents`

### Purpose

- Upload documents (file or plain text) into a **project**
- Track indexing progress (`loaded_chunks / total_chunks`)
- Search and delete documents

### Upload panel (left)

#### 1) Select project (required)

- The project determines the **embedding model** used for indexing.
- The embedding model is shown read‑only once you select a project.

#### 2) Choose upload type

- **File Upload**: supports `TXT`, `PDF`, `DOC`, `DOCX`
- **Text Input**: paste text directly

#### 3) Upload

- Click **Upload**
- The document appears in the list; indexing progress updates live

### Document list (right)

- **Search by name**: client-side name filter
- **Filter by project**: narrow down the list
- **Chunks column**:
  - shows a progress bar while indexing
  - switches to a number when complete
- **Delete**:
  - deletes document from the selected project

### Real-time updates

This page listens to WebSocket updates on:
- `/ws/documents`

That’s how the UI shows indexing progress without manual refresh.

## Projects

Path: `/projects`

### Purpose

Projects separate your document indexes and settings:

- each project has its own document table + Qdrant collection
- each project has an **embedding model** used for ingestion/search

### Create a project

1) Click **New Project**
2) Set **Project Name**
3) Choose **Embedding Model**
   - the list is based on installed models with `embedding` capability
   - includes `frida` as a special RU-focused option
4) Click **Save**

### Edit a project

- You can rename a project
- Embedding model is **locked** for existing projects (UI disables changes)

### Project stats

The table shows **Documents** count per project (loaded via `/api/projects/{id}/stats`).

### Real-time updates

This page listens to:
- `/ws/projects`

to update project list and stats without manual refresh.

## Models

Path: `/models`

### Purpose

Manage AI models:

- view installed models (Ollama)
- browse available models
- install (“pull”) models with selected size
- track download progress live
- delete installed models

### Screenshot

![Models page (illustration)](../assets/ui-models.svg)

### Lists and filters

- **Search**: by name/description
- **Capability filter**:
  - `embedding`
  - `vision`
  - `tools`
  - or `all`

### Install a model

1) Find a model card with status **Available**
2) Select a **size** (tag)
3) Click **Install**

Progress is shown:

- on the model card (percent + progressbar)
- via WebSocket updates (no refresh needed)

### Delete a model

For installed models (**Installed**):

- click **Delete**
- confirm

### Real-time updates

This page listens to:
- `/ws/models`

to update download progress and refresh lists when a model becomes ready.

## Chat

Path: `/chat`

### Purpose

Chat with your documents using RAG:

- selects relevant chunks from your project
- optionally reranks them
- generates an answer with your chosen model

### Controls (top bar)

- **Project**: determines which document index is used
- **Model**:
  - local Ollama models (installed)
  - OpenRouter models (prefixed as `openrouter/...`)
  - embedding-only models are hidden from this list
- **Use Reranker**: toggles reranking stage
- **Hybrid search**: combines vector + keyword search
- **Show thinking**: shows the model “thinking” section if available

### Asking questions

1) Select a project and model  
2) Type a message and press **Send**

The UI calls:
- `POST /api/ai/rag`

### Sources panel

Assistant responses can include:

- **Thinking** (collapsible)
- **Sources** (collapsible): filename, similarity, chunk content, metadata

### Push-to-talk (STT)

The chat input has a mic button:

- Hold to record → release to send
- UI sends audio to:
  - `POST /api/stt/transcribe` (language defaults to `ru`)
- The transcribed text is then sent as a normal chat message

### Notes / limitations

- You must have at least one project and at least one non-embedding model available.
- If STT/TTS services are not running, voice features will fail.

## Voice (TTS/STT)

Path: `/voice`

This page is a playground for:

- **TTS**: Text-to-Speech (Silero)
- **STT**: Speech-to-Text (Whisper)

### TTS tab

#### Controls

- **Voice**: fetched from `GET /api/tts/voices`
- **Language**: currently `ru` only (disabled in UI)
- **Speed**: 0.5× … 2.0×
- **Quality (sample rate)**: 8k / 24k / 48k
- **Quick phrases**: one-click presets to fill the text box

#### How to synthesize

1) Enter text (up to 1000 chars)
2) Click **Synthesize**
3) Audio plays automatically
4) Optional: **Download** to save WAV

The UI calls:
- `POST /api/tts/synthesize/stream`

### STT tab

#### Controls

- **Whisper model**:
  - list from `GET /api/stt/models`
  - switching triggers `POST /api/stt/model/load`
- **Language**: choose transcription language (default `ru`)

#### How to transcribe

1) Click the mic button to start recording
2) Click again to stop
3) Wait for transcription result

The UI calls:
- `POST /api/stt/transcribe` (multipart form)

#### Actions on result

- Copy
- Clear
- Send to TTS (“Synthesize” button)

## API (Swagger in UI)

Path: `/swagger`

This page bundles API onboarding for UI users:

- overview of external endpoints
- your API keys (quick copy)
- code examples (curl / Python / JS)
- embedded Swagger UI (`/api/docs`)

### Tabs

#### API Overview

- Lists the main endpoint groups and their purpose.

#### My API Keys

- Shows API keys for the current user
- You can copy the key value
- For management (create/delete), it links you to `/users`

#### Code Examples

- Copy‑paste examples for:
  - RAG
  - OpenAI-compatible chat
  - TTS

#### Swagger Docs

- Embedded interactive Swagger UI loaded from `/api/docs`
- Tip: click **Authorize** and paste your token/key as:

```
Bearer <TOKEN>
```

## Users & API keys

Path: `/users`

### Purpose

- Manage users (create/edit/delete)
- Manage **API keys** for users (create/copy/delete)

API keys are used for external integrations and can be sent as:

```
Authorization: Bearer <API_KEY>
```

### Users table

Shows:

- Email
- Role (Admin/User)
- Created date
- Actions:
  - **API Keys**
  - **Edit**
  - **Delete**

### Create a user

1) Click **Add User**
2) Fill:
   - Email
   - Password
   - Role (`user` / `admin`)
3) Click **Save**

### Edit a user

- Password can be left blank to keep the current password.

### API keys dialog

1) Click the **key** icon for a user
2) Create a key:
   - set name
   - click **Create**
3) Copy the key value (copy icon)
4) Delete keys if needed

> Keep API keys secret — they grant access as that user.

## Request Logs

Path: `/request-logs`

### Purpose

Inspect request history for troubleshooting and monitoring:

- which endpoints are called
- response time / slow requests
- which model was used (if available)

This page uses:
- `GET /api/admin/logs` (also available to non-admins in a limited form)

### Filters

- Method (GET/POST/PUT/DELETE)
- Path contains
- Start/end datetime

Admin-only:

- Filter by User
- See IP addresses
- See request/response bodies in details
- “User Stats” table (`/api/admin/stats/users`)

### Details dialog

Click **Details** to see:

- method, path, category
- model name
- response time
- user text (if captured)
- request/response bodies (admin only)

## Profile

Path: `/profile`

### Purpose

- See your account info and activity
- Switch UI theme (light/system/dark)

### What you see

- **Account**
  - email / username
  - role (administrator vs user)
  - member since
  - last activity
- **Usage statistics**
  - projects count
  - API keys count
  - requests/month
  - storage used (MB)
  - total requests
- **Recent activity**
  - method + path + response time
  - relative time (“Just now”, “10 min ago”, ...)

### Theme

Theme is stored in `localStorage` (`theme` key) and applied after page reload.

