#!/bin/sh

# Start Ollama server
ollama serve &
SERVER_PID=$!

# Wait for Ollama to start
sleep 5

# Pull the embedding model if specified
if [ ! -z "$EMBEDDING_MODEL" ]; then
    echo "Pulling embedding model: $EMBEDDING_MODEL"
    ollama pull $EMBEDDING_MODEL
fi

# Create a health check file to indicate service is running
touch /tmp/ollama_ready

# Keep container running but also monitor the Ollama server process
wait $SERVER_PID
