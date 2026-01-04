FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir flask pynvml

COPY services/gpu-info/app.py /app/app.py

ENV PORT=8005
EXPOSE 8005

CMD ["python", "/app/app.py"]

