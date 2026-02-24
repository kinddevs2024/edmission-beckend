# Edmission Backend

Backend платформы Edmission: Express, TypeScript, Prisma, Socket.io, Ollama (DeepSeek).

## Стек

- **Runtime:** Node.js 20+
- **Framework:** Express
- **Язык:** TypeScript
- **БД:** PostgreSQL 15+, Prisma
- **Аутентификация:** JWT (access + refresh)
- **Чат (real-time):** Socket.io
- **AI:** Ollama (модель DeepSeek 7B)
- **Cron:** node-cron (рекомендации каждые 5 мин)

## Установка

```bash
npm install
cp .env.example .env
# Заполнить DATABASE_URL, JWT_SECRET и при необходимости OLLAMA_*
npx prisma generate
npx prisma migrate dev
```

## Запуск

```bash
# API + Socket.io (воркер рекомендаций запускается в том же процессе)
npm run dev

# Отдельно воркер рекомендаций (опционально)
npm run worker
```

## Переменные окружения

См. `.env.example`. Основные:

- `DATABASE_URL` — строка подключения PostgreSQL
- `JWT_SECRET`, `JWT_REFRESH_SECRET` — секреты для JWT
- `OLLAMA_BASE_URL` — URL Ollama (по умолчанию http://localhost:11434)
- `OLLAMA_MODEL` — модель (по умолчанию deepseek-llm:7b)

## API

Базовый префикс: `/api`.

- **Auth:** `/api/auth` — register, login, refresh, logout, me, verify-email, forgot-password, reset-password
- **Student:** `/api/student` — profile, dashboard, universities, interest, applications, offers, recommendations, compare
- **University:** `/api/university` — profile, dashboard, students, pipeline, interests, scholarships, offers, recommendations
- **Admin:** `/api/admin` — dashboard, users, suspend, verification, health, logs
- **Chat:** `/api/chat` — список чатов, сообщения, mark read
- **AI:** `POST /api/ai/chat` — body `{ "message": "..." }`, ответ `{ "reply": "..." }`
- **Notifications:** `/api/notifications` — список, mark read, read-all

## Socket.io

- Подключение с токеном: `auth: { token: accessToken }` или query `?token=...`
- События: `join_chat`, `send_message`, `mark_read`, `typing`
- Сервер эмитит: `new_message`, `messages_read`, `user_typing`, `notification`

## Интеграция Ollama (DeepSeek)

1. Установить Ollama и скачать модель: `ollama pull deepseek-llm:7b`
2. В `.env` задать `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, при необходимости `AI_CHAT_RATE_LIMIT_PER_MINUTE`, `AI_CHAT_TIMEOUT_MS`
3. `POST /api/ai/chat` с JWT и телом `{ "message": "..." }` — контекст (GPA, офферы, рекомендации) собирается на бэке, ответ возвращается от модели

Подробнее: [OLLAMA-DEEPSEEK-INTEGRATION.md](./OLLAMA-DEEPSEEK-INTEGRATION.md) и [BACKEND-PLAN.md](./BACKEND-PLAN.md).
