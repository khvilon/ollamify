# Ollamify

A powerful document management and RAG (Retrieval Augmented Generation) system built with Ollama and modern web technologies.

## Features

- **Document Management**
  - Upload and process multiple document formats (PDF, DOCX, TXT)
  - Automatic text extraction and chunking
  - Document organization by projects
  - Progress tracking for document processing
  - Document search and filtering

- **RAG Capabilities**
  - Question answering based on document content
  - Multiple embedding model support
  - Semantic and hybrid (embeddings + keyword) search with per-request toggle
  - Context-aware responses
- **Voice Interface (TTS/STT)**
  - Text-to-Speech synthesis with multiple voices
  - Multi-language support (16+ languages)
  - Voice parameter customization (speed, quality)
  - Web-based audio player and download
  - REST API for voice synthesis
  - Future: Speech-to-Text and voice cloning
- **Model Management**
  - Integration with Ollama models
  - Support for OpenRouter models
  - Model download and status tracking
  - Capability-based model filtering

- **User Management & Security**
  - User registration and authentication
  - Role-based access control (admin/user)
  - API key generation and management
  - Token-based authentication for API access
  - Secure password hashing and storage
  - Session management and JWT tokens

## Components

### Frontend Pages

1. **Documents** (`/documents`)
   - Upload documents via file or direct text input
   - View document list with metadata
   - Filter documents by project
   - Track document processing progress
   - Delete documents
   - Sort and paginate document list

2. **Chat** (`/chat`)
   - Ask questions about documents
   - Select project context for questions
   - Choose between different LLM models
   - View conversation history
   - Markdown support for responses
   - Real-time model status updates

3. **Models** (`/models`)
   - View installed and available models
   - Download new models
   - Track download progress
   - Filter models by capabilities
   - Search through model list
   - View model metadata and tags

4. **Projects** (`/projects`)
   - Create and manage projects
   - Select embedding models for projects
   - View project statistics
   - Delete projects with confirmation
   - Track document count per project

5. **Users & API Keys** (`/users`)
   - User account management
   - Create and manage API keys
   - View API key usage statistics
   - Set API key permissions and limits
   - Enable/disable API keys
   - User role management (admin only)
   - Password change functionality

## Setup

1. Clone the repository
2. Copy `.env_example` to `.env` and configure:
   ```
   # Database Configuration
   POSTGRES_USER=your_user
   POSTGRES_PASSWORD=your_password
   POSTGRES_DB=your_db

   # JWT Configuration
   JWT_SECRET=your_jwt_secret
   JWT_EXPIRY=24h

   # Embedding Model
   EMBEDDING_MODEL=all-minilm

   # OpenRouter Configuration
   OPENROUTER_API_KEY=your_api_key
   OPENROUTER_MODEL=your_model
   OPENROUTER_URL=https://openrouter.ai/api/v1/chat/completions
   ```

3. Start the services:

   The system can run in two modes: CPU-only or with GPU support. The startup script will automatically detect NVIDIA GPU and choose the appropriate mode.

   **Linux/macOS:**
   ```bash
   # Auto-detect GPU and start
   ./start.sh

   # Force CPU mode even if GPU is available
   ./start.sh --cpu
   ```

   **Windows (using Git Bash or WSL):**
   ```bash
   # Using Git Bash
   bash start.sh

   # Using WSL
   wsl bash /mnt/c/path/to/ollamify/start.sh
   ```

   **Requirements for GPU mode:**
   - NVIDIA GPU
   - NVIDIA drivers installed
   - NVIDIA Container Toolkit (nvidia-docker2)

## Architecture

The system consists of several microservices:

- **Zeus** - Main backend service handling documents and RAG
- **Auth** - Authentication service
- **WWW3** - Frontend service
- **Ollama** - Local model service
- **PostgreSQL** - Database with pgvector extension

## API Endpoints

### Documents
- `GET /api/documents` - List documents
- `POST /api/documents` - Upload document
- `DELETE /api/documents/:id` - Delete document
- `GET /api/documents/projects` - List projects

### Projects
- `GET /api/projects` - List projects
- `POST /api/projects` - Create project
- `DELETE /api/projects/:id` - Delete project
- `GET /api/projects/:id/stats` - Get project stats

### Models
- `GET /api/models` - List installed models
- `GET /api/models/available` - List available models
- `POST /api/models/:name` - Download model

### AI
- `POST /api/ai/rag` - Question answering
- `POST /api/ai/rag/chunks` - Retrieve relevant document chunks

> Параметр `useHybridSearch` (по умолчанию `true`) позволяет переключаться между гибридным поиском и поиском только по эмбеддингам.
- `POST /api/ai/embed` - Get embeddings

## Technologies

- Frontend: React with Material-UI
- Backend: Node.js with Express
- Database: PostgreSQL with pgvector
- Models: Ollama, OpenRouter
- Containerization: Docker

## License

MIT License
