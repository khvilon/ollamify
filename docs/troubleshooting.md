# Troubleshooting

**Language:** **English** | [Русский](troubleshooting.ru.md)

## GPU is not detected

- Make sure NVIDIA drivers are installed
- Make sure NVIDIA Container Toolkit is installed/configured
- Quick check:

```bash
docker run --rm --gpus all nvidia/cuda:12.6.1-base-ubuntu24.04 nvidia-smi
```

## Build fails with `pypi.nvidia.com timed out`

Some networks block `pypi.nvidia.com`. GPU images now use safer pip flags, but if your network is slow:

- Rebuild with increased timeouts:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml build --no-cache --build-arg PIP_TIMEOUT=300 --build-arg PIP_RETRIES=20 tts
```

## Can’t login

- Default dev credentials: `admin@example.com` / `admin`
- Check containers:

```bash
docker compose ps
docker compose logs -f db auth www3 zeus
```

