# Documents

**Language:** **English** | [Русский](documents.ru.md)

Path in UI: `/documents`

## Purpose

- Upload documents (file or plain text) into a **project**
- Track indexing progress (`loaded_chunks / total_chunks`)
- Search and delete documents

## Upload panel (left)

### 1) Select project (required)

- The project determines the **embedding model** used for indexing.
- The embedding model is shown read‑only once you select a project.

### 2) Choose upload type

- **File Upload**: supports `TXT`, `PDF`, `DOC`, `DOCX`
- **Text Input**: paste text directly

### 3) Upload

- Click **Upload**
- The document appears in the list; indexing progress updates live

## Document list (right)

- **Search by name**: client-side name filter
- **Filter by project**: narrow down the list
- **Chunks column**:
  - shows a progress bar while indexing
  - switches to a number when complete
- **Delete**:
  - deletes document from the selected project

## Real-time updates

This page listens to WebSocket updates on:
- `/ws/documents`

That’s how the UI shows indexing progress without manual refresh.

