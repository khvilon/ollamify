# Projects

**Language:** **English** | [Русский](projects.ru.md)

Path in UI: `/projects`

## Purpose

Projects separate your document indexes and settings:

- each project has its own document table + Qdrant collection
- each project has an **embedding model** used for ingestion/search

## Create a project

1) Click **New Project**
2) Set **Project Name**
3) Choose **Embedding Model**
   - the list is based on installed models with `embedding` capability
   - includes `frida` as a special RU-focused option
4) Click **Save**

## Edit a project

- You can rename a project
- Embedding model is **locked** for existing projects (UI disables changes)

## Project stats

The table shows **Documents** count per project (loaded via `/api/projects/{id}/stats`).

## Real-time updates

This page listens to:
- `/ws/projects`

to update project list and stats without manual refresh.

