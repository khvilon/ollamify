#!/usr/bin/env bash
set -Eeuo pipefail

# -----------------------------
# Ollamify universal launcher
# - supports docker compose v2 and docker-compose v1
# - auto GPU detection (NVIDIA)
# - supports --cpu / -c flag
# -----------------------------

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CPU_MODE=0
if [[ "${1:-}" == "--cpu" || "${1:-}" == "-c" ]]; then
  CPU_MODE=1
fi

# ---- helpers ----
log() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Determine compose command:
# Prefer Compose v2 plugin: "docker compose"
# Fallback to v1: "docker-compose"
compose_cmd() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker compose"
    return 0
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
    return 0
  fi
  return 1
}

# Check docker daemon availability
check_docker() {
  command -v docker >/dev/null 2>&1 || die "docker not found. Install Docker first."
  docker info >/dev/null 2>&1 || die "Docker daemon is not running. Try: systemctl enable --now docker"
}

# NVIDIA detection:
# 1) If nvidia-smi exists and can query GPU -> OK
# 2) Else, if docker can run GPU-enabled container -> OK
check_nvidia() {
  # fast path: nvidia-smi on host/VM
  if command -v nvidia-smi >/dev/null 2>&1; then
    if nvidia-smi --query-gpu=gpu_name --format=csv,noheader >/dev/null 2>&1; then
      return 0
    fi
  fi

  # fallback: check Docker GPU runtime
  # NOTE: this requires nvidia-container-toolkit to be configured
  if command -v docker >/dev/null 2>&1; then
    docker run --rm --gpus all --pull=never nvidia/cuda:12.6.1-base-ubuntu24.04 nvidia-smi >/dev/null 2>&1 && return 0
  fi

  return 1
}

# Count NVIDIA GPUs (best-effort).
# Returns "0" if no NVIDIA GPUs detected.
nvidia_gpu_count() {
  # fast path: nvidia-smi on host/VM
  if command -v nvidia-smi >/dev/null 2>&1; then
    local out
    out="$(nvidia-smi --query-gpu=index --format=csv,noheader 2>/dev/null || true)"
    if [[ -n "${out}" ]]; then
      printf '%s\n' "${out}" | wc -l | tr -d ' '
      return 0
    fi
  fi

  # fallback: check via Docker GPU runtime (requires cached image, see check_nvidia)
  if command -v docker >/dev/null 2>&1; then
    local out
    out="$(docker run --rm --gpus all --pull=never nvidia/cuda:12.6.1-base-ubuntu24.04 nvidia-smi --query-gpu=index --format=csv,noheader 2>/dev/null || true)"
    if [[ -n "${out}" ]]; then
      printf '%s\n' "${out}" | wc -l | tr -d ' '
      return 0
    fi
  fi

  echo 0
}

# ---- main ----
COMPOSE="$(compose_cmd || true)"
[[ -n "${COMPOSE}" ]] || die "Neither 'docker compose' (v2) nor 'docker-compose' (v1) found."

check_docker

BASE_FILE="docker-compose.yml"
GPU_FILE="docker-compose.gpu.yml"
GPU2_FILE="docker-compose.gpu-2.yml"

if [[ ! -f "$BASE_FILE" ]]; then
  die "Missing $BASE_FILE in $SCRIPT_DIR"
fi

# Decide mode
if [[ "$CPU_MODE" -eq 0 ]] && check_nvidia; then
  GPU_COUNT="$(nvidia_gpu_count || echo 1)"
  if [[ "${GPU_COUNT}" -ge 2 ]] && [[ -f "$GPU2_FILE" ]]; then
    log "Обнаружено ${GPU_COUNT} NVIDIA GPU, запускаем с поддержкой GPU (2 Ollama инстанса: GPU0 + GPU1)..."
    # shellcheck disable=SC2086
    $COMPOSE -f "$BASE_FILE" -f "$GPU_FILE" -f "$GPU2_FILE" up -d
  else
    log "NVIDIA GPU обнаружена, запускаем с поддержкой GPU (1 Ollama инстанс: GPU0)..."
  if [[ -f "$GPU_FILE" ]]; then
    # shellcheck disable=SC2086
    $COMPOSE -f "$BASE_FILE" -f "$GPU_FILE" up -d
  else
    log "Предупреждение: $GPU_FILE не найден. Запускаю только $BASE_FILE."
    # shellcheck disable=SC2086
    $COMPOSE -f "$BASE_FILE" up -d
    fi
  fi
else
  if [[ "$CPU_MODE" -eq 1 ]]; then
    log "Запускаем в режиме CPU (принудительно)..."
  else
    log "Запускаем в режиме CPU (так как GPU не обнаружена)..."
  fi
  # shellcheck disable=SC2086
  $COMPOSE -f "$BASE_FILE" up -d
fi

log "Ollamify запускается... Пожалуйста, подождите."
