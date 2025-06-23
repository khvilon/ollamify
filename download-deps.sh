#!/bin/bash

# Создаем папки для зависимостей
mkdir -p services/www3/static/js/vendor
mkdir -p services/www3/static/css/vendor
mkdir -p services/www3/static/fonts

echo "Скачиваем React и зависимости..."

# React
curl -o services/www3/static/js/vendor/react.development.js \
  "https://unpkg.com/react@18.3.1/umd/react.development.js"

curl -o services/www3/static/js/vendor/react-dom.development.js \
  "https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"

echo "Скачиваем React Router..."

# React Router
curl -o services/www3/static/js/vendor/router.umd.min.js \
  "https://unpkg.com/@remix-run/router@1.14.1/dist/router.umd.min.js"

curl -o services/www3/static/js/vendor/react-router.development.js \
  "https://unpkg.com/react-router@6.21.1/dist/umd/react-router.development.js"

curl -o services/www3/static/js/vendor/react-router-dom.development.js \
  "https://unpkg.com/react-router-dom@6.21.1/dist/umd/react-router-dom.development.js"

echo "Скачиваем Material UI..."

# Material UI
curl -o services/www3/static/js/vendor/emotion-react.umd.min.js \
  "https://unpkg.com/@emotion/react@11.11.1/dist/emotion-react.umd.min.js"

curl -o services/www3/static/js/vendor/emotion-styled.umd.min.js \
  "https://unpkg.com/@emotion/styled@11.11.0/dist/emotion-styled.umd.min.js"

curl -o services/www3/static/js/vendor/material-ui.development.js \
  "https://unpkg.com/@mui/material@5.14.13/umd/material-ui.development.js"

# Попробуем найти рабочую ссылку для DataGrid
echo "Ищем рабочую ссылку для MUI DataGrid..."
curl -o services/www3/static/js/vendor/mui-x-data-grid.js \
  "https://unpkg.com/@mui/x-data-grid@6.18.6/dist/index.umd.js" || \
curl -o services/www3/static/js/vendor/mui-x-data-grid.js \
  "https://unpkg.com/@mui/x-data-grid@6.18.6/build/index.js" || \
echo "DataGrid не найден, пропускаем..."

echo "Скачиваем вспомогательные библиотеки..."

# Markdown и Babel
curl -o services/www3/static/js/vendor/marked.min.js \
  "https://cdn.jsdelivr.net/npm/marked/marked.min.js"

curl -o services/www3/static/js/vendor/babel.min.js \
  "https://unpkg.com/@babel/standalone@7.27.6/babel.min.js"

echo "Скачиваем шрифты Google..."

# Скачиваем CSS для шрифтов Roboto
curl -o services/www3/static/css/vendor/roboto.css \
  "https://fonts.googleapis.com/css?family=Roboto:300,400,500,700&display=swap"

# Скачиваем CSS для Material Icons
curl -o services/www3/static/css/vendor/material-icons.css \
  "https://fonts.googleapis.com/icon?family=Material+Icons"

# Скачиваем файлы шрифтов Roboto
echo "Скачиваем файлы шрифтов..."
curl -o services/www3/static/fonts/roboto-300.woff2 \
  "https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1MHoqbEu0LDylTylUAMa3yUBA.woff2"

curl -o services/www3/static/fonts/roboto-400.woff2 \
  "https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1MEeqKKu0LDylTylUAMa3yUBA.woff2"

curl -o services/www3/static/fonts/roboto-500.woff2 \
  "https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3yUBA.woff2"

curl -o services/www3/static/fonts/roboto-700.woff2 \
  "https://fonts.gstatic.com/s/roboto/v48/KFO7CnqEu92Fr1MH5qWLu0LDylTylUAMa3yUBA.woff2"

# Material Icons
curl -o services/www3/static/fonts/material-icons.woff2 \
  "https://fonts.gstatic.com/s/materialicons/v143/flUhRq6tzZclQEJ-Vdg-IuiaDsNc.woff2"

echo "Все зависимости скачаны!" 