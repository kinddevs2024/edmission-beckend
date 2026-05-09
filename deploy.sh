#!/bin/bash
# ============================================================
# Edmission Backend — Deploy Script
# Запускать на сервере: bash deploy.sh
# ============================================================

set -e  # Остановить при любой ошибке

echo "=============================="
echo "  EDMISSION DEPLOY STARTED"
echo "  $(date)"
echo "=============================="

# 1. Получаем последний код с GitHub
echo ""
echo "[1/5] Pulling latest code from GitHub..."
git pull origin main

# 2. Устанавливаем зависимости (если появились новые)
echo ""
echo "[2/5] Installing dependencies..."
npm install --omit=dev

# 3. ВАЖНО: Удаляем старую сборку чтобы не было старого кода
echo ""
echo "[3/5] Removing old build (dist/)..."
rm -rf dist

# 4. Собираем новый TypeScript
echo ""
echo "[4/5] Building TypeScript..."
npm run build

# 5. Перезапускаем PM2
echo ""
echo "[5/5] Restarting PM2..."
pm2 restart edmission-back

echo ""
echo "=============================="
echo "  DEPLOY COMPLETE!"
echo "  $(date)"
echo "=============================="
echo ""
echo "Check bot logs: pm2 logs edmission-back --lines 20"
