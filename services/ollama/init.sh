#!/bin/sh

# Start Ollama server
ollama serve &
SERVER_PID=$!

# Wait for Ollama to start
sleep 5

# Models will be downloaded through the web interface as needed
echo "Ollama server is ready. Models can be downloaded through the web interface."

# Create a health check file to indicate service is running
touch /tmp/ollama_ready

# Keep container running but also monitor the Ollama server process
wait $SERVER_PID
