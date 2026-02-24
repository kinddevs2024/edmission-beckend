# Подключение Ollama (DeepSeek) к бэкенду Edmission

Краткая инструкция: как установить Ollama и модель DeepSeek локально, и как подключить их к API бэкенда.

---

## 1. Установка Ollama (уже сделано у тебя)

- **Windows:** скачать [OllamaSetup.exe](https://ollama.com/download) или в PowerShell:
  ```powershell
  irm https://ollama.com/install.ps1 | iex
  ```
- После установки Ollama работает в фоне, API доступен по адресу: **http://localhost:11434**.

---

## 2. Модель DeepSeek в Ollama

### Варианты моделей

| Модель | Команда | Описание | Размер |
|--------|---------|----------|--------|
| **DeepSeek LLM 7B** (чат) | `ollama pull deepseek-llm:7b` | Универсальная чат-модель 7B, подходит для ассистента | ~4–5 GB |
| DeepSeek R1 1.5B | `ollama pull deepseek-r1:1.5b` | Самая лёгкая, быстрая | ~1 GB |
| DeepSeek R1 8B | `ollama pull deepseek-r1:8b` | Рассуждения, сильнее 7B | ~5 GB |

Для Edmission в блюпринте указан **DeepSeek 7B** — используй **deepseek-llm:7b**.

### Загрузка модели

В терминале (Ollama должен быть запущен):

```bash
ollama pull deepseek-llm:7b
```

Проверка:

```bash
ollama list
ollama run deepseek-llm:7b "Привет, как дела?"
```

Если всё отвечает — модель готова к использованию из бэкенда.

---

## 3. Как бэкенд будет обращаться к Ollama

- Ollama **не открывается в интернет**. К нему обращается **только наш бэкенд** с того же сервера по `http://localhost:11434`.
- Фронт и пользователи **никогда** не ходят на порт 11434. Все запросы идут так:
  - Пользователь → **наш API** (например, `POST /api/ai/chat`) → бэкенд собирает контекст → бэкенд вызывает Ollama → ответ возвращается через наш API.

---

## 4. План подключения к бэкенду (по шагам)

### Шаг 1. Переменные окружения

В `.env` бэкенда:

```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=deepseek-llm:7b
AI_CHAT_RATE_LIMIT_PER_MINUTE=10
AI_CHAT_TIMEOUT_MS=60000
```

- `OLLAMA_BASE_URL` — на продакшене может быть другой хост (если Ollama на отдельной машине).
- `OLLAMA_MODEL` — имя модели, которую дергаем (то же, что в `ollama pull`).
- Rate limit и timeout — чтобы не перегружать Ollama и не висеть бесконечно.

### Шаг 2. HTTP-клиент для Ollama

Файл: `src/ai/ollama.client.ts`

- Метод типа `chat(messages: { role: 'system' | 'user' | 'assistant'; content: string }[]): Promise<string>`.
- Внутри — `POST ${OLLAMA_BASE_URL}/api/chat` с телом в формате [Ollama Chat API](https://github.com/ollama/ollama/blob/main/docs/api.md#generate-a-chat-completion):
  - `model`: из `OLLAMA_MODEL`,
  - `messages`: массив ролей и контента,
  - при необходимости `stream: false` для простого ответа одним блоком.
- Обработка ошибок (Ollama недоступен, таймаут) и логирование.
- Таймаут запроса — из `AI_CHAT_TIMEOUT_MS`.

### Шаг 3. Сбор контекста для промпта

Файл: `src/ai/context.builder.ts`

- На вход: `userId`, `role` (student | university).
- Из БД (через сервисы/репозитории) достаём только то, что нужно для подсказок:
  - **Студент:** GPA, страна, направление, топ рекомендаций (названия вузов, match %), список офферов (вуз, стипендия, дедлайн), статусы заявок.
  - **Университет:** краткая воронка (сколько в каждом статусе), список стипендий, последние заинтересованные студенты.
- Формируем **текстовый контекст** (не сырые пароли/токены). Никаких персональных данных сверх необходимого для совета по поступлению.
- Возвращаем строку или структуру для вставки в system prompt.

### Шаг 4. Системные промпты

Файл: `src/ai/prompts.ts`

- Функции вида `getSystemPrompt(role: 'student' | 'university', context: string): string`.
- В промпте: роль ассистента («ты помощник Edmission по поступлению»), правила (не выдумывать факты, не давать личные советы по здоровью и т.д.), и подставленный `context`.
- Язык ответа — из запроса пользователя или по умолчанию русский/английский (можно передать в контексте).

### Шаг 5. AI-сервис

Файл: `src/services/ai.service.ts`

- `chat(userId: string, role: string, userMessage: string): Promise<string>`.
- Проверка rate limit по `userId` (например, 10 запросов в минуту).
- Вызов `context.builder` → получение контекста.
- Сборка сообщений: `[{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }]`.
- Вызов `ollama.client.chat(messages)`.
- Возврат ответа модели (или ошибки с понятным сообщением для фронта).

### Шаг 6. Роут и контроллер

- **POST /api/ai/chat**  
  - Body: `{ message: string }`.  
  - Middleware: auth (JWT), затем вызов `ai.service.chat(req.user.id, req.user.role, body.message)`.  
  - Ответ: `{ reply: string }` или стрим (если позже добавите streaming).  
  - Ошибки: 429 (rate limit), 503 (Ollama недоступен), 504 (таймаут).

### Шаг 7. Безопасность

- Порт 11434 **не пробрасывать** в фаервол и не открывать наружу.
- В коде обращаться только к `OLLAMA_BASE_URL` (на проде — внутренний адрес сервера с Ollama).
- Контекст собирается **только на бэкенде** из своей БД; пользователь не может подсунуть произвольный контекст в запросе.
- В логах не писать полные тела запросов/ответов с персональными данными.

---

## 5. Порядок реализации в коде

1. Добавить переменные в `.env` и в `config` (чтение `process.env`).
2. Реализовать `ollama.client.ts` (только HTTP к Ollama, без логики приложения).
3. Реализовать `context.builder.ts` и `prompts.ts`.
4. Реализовать `ai.service.ts` (контекст + промпт + вызов клиента + rate limit).
5. Добавить роут `POST /api/ai/chat` и контроллер, подключить в приложение.
6. Написать тест: с запущенной Ollama и моделью `deepseek-llm:7b` отправить запрос и проверить ответ.

---

## 6. Проверка после подключения

- Убедиться, что Ollama запущен и модель загружена: `ollama list`.
- Вызвать API бэкенда с валидным JWT:
  ```bash
  curl -X POST http://localhost:YOUR_API_PORT/api/ai/chat \
    -H "Authorization: Bearer <access_token>" \
    -H "Content-Type: application/json" \
    -d "{\"message\": \"Какие у меня шансы поступить?\"}"
  ```
- Ожидать в ответе JSON с полем `reply` и текстом от модели.

---

## 7. Если Ollama на другой машине

- На той машине установить Ollama и выполнить `ollama pull deepseek-llm:7b`.
- Запустить Ollama с привязкой к сети, например: `OLLAMA_HOST=0.0.0.0 ollama serve` (только во внутренней сети).
- В `.env` бэкенда указать: `OLLAMA_BASE_URL=http://IP_СЕРВЕРА_OLLAMA:11434`.

После этого план интеграции можно считать выполненным: DeepSeek подключён к бэкенду через один эндпоинт и не светится наружу.
