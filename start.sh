#!/bin/bash

# Функция для проверки наличия NVIDIA GPU
check_nvidia() {
    if command -v nvidia-smi &> /dev/null; then
        if nvidia-smi --query-gpu=gpu_name --format=csv,noheader &> /dev/null; then
            return 0  # GPU найдена
        fi
    fi
    return 1  # GPU не найдена
}

# Проверяем аргументы
CPU_MODE=0
if [ "$1" = "--cpu" ] || [ "$1" = "-c" ]; then
    CPU_MODE=1
fi

# Определяем наличие GPU
if [ $CPU_MODE -eq 0 ] && check_nvidia; then
    echo "NVIDIA GPU обнаружена, запускаем с поддержкой GPU..."
    docker-compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
else
    if [ $CPU_MODE -eq 1 ]; then
        echo "Запускаем в режиме CPU (принудительно)..."
    else
        echo "Запускаем в режиме CPU (так как GPU не обнаружена)..."
    fi
    docker-compose up -d
fi

echo "Ollamify запускается... Пожалуйста, подождите."
