# Models

**Language:** **English** | [Русский](models.ru.md)

Path in UI: `/models`

## Purpose

Manage AI models:

- view installed models (Ollama)
- browse available models
- install (“pull”) models with selected size
- track download progress live
- delete installed models

## Lists and filters

- **Search**: by name/description
- **Capability filter**:
  - `embedding`
  - `vision`
  - `tools`
  - or `all`

## Install a model

1) Find a model card with status **Available**
2) Select a **size** (tag)
3) Click **Install**

Progress is shown:

- on the model card (percent + progressbar)
- via WebSocket updates (no refresh needed)

## Delete a model

For installed models (**Installed**):

- click **Delete**
- confirm

## Real-time updates

This page listens to:
- `/ws/models`

to update download progress and refresh lists when a model becomes ready.

