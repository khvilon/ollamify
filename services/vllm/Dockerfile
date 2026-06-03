FROM vllm/vllm-openai:latest

WORKDIR /app

RUN pip install --no-cache-dir flask requests

COPY app.py /app/app.py

ENV PORT=8007
ENV VLLM_INNER_HOST=127.0.0.1
ENV VLLM_INNER_PORT=8008
ENV VLLM_LOAD_TIMEOUT_SECONDS=600

EXPOSE 8007

ENTRYPOINT ["python3", "/app/app.py"]
