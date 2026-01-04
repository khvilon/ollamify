# Troubleshooting

[English](troubleshooting.md) | **Русский**

## GPU не обнаруживается

- Проверьте, что установлены NVIDIA драйверы
- Проверьте, что установлен/настроен NVIDIA Container Toolkit
- Быстрая проверка:

```bash
docker run --rm --gpus all nvidia/cuda:12.6.1-base-ubuntu24.04 nvidia-smi
```

## Сборка падает с `pypi.nvidia.com timed out`

В некоторых сетях `pypi.nvidia.com` блокируется. GPU Dockerfile’ы уже используют более безопасные параметры pip, но при медленной сети можно увеличить таймауты:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml build --no-cache --build-arg PIP_TIMEOUT=300 --build-arg PIP_RETRIES=20 tts
```

## Не получается залогиниться

- Дефолтные dev‑данные: `admin@example.com` / `admin`
- Проверьте контейнеры и логи:

```bash
docker compose ps
docker compose logs -f db auth www3 zeus
```

