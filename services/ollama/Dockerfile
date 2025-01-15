FROM ollama/ollama:latest

COPY services/ollama/init.sh /init.sh
RUN chmod +x /init.sh

ENTRYPOINT ["/init.sh"]
