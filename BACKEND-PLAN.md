# EDMISSION — Детальный план бэкенда (V1)

Документ описывает пошаговый план разработки бэкенда платформы Edmission на основе полного блюпринта и технической спецификации. Реализация — после утверждения плана.

---

## 1. Стек и окружение

| Категория | Выбор | Обоснование |
|-----------|--------|-------------|
| Runtime | **Node.js 20+** | LTS, производительность |
| Framework | **Express** | Явное разделение API и воркеров; проще разнести процессы (API, cron, AI). Next API — альтернатива, если нужен один репозиторий с SSR |
| Язык | **TypeScript** | Типобезопасность, контракты с фронтом |
| БД | **PostgreSQL 15+** | По блюпринту, JSONB для breakdown |
| ORM | **Prisma** | Миграции, типы из схемы, удобные связи |
| Аутентификация | **JWT** (access + refresh) | Access — короткий срок (15–30 мин), refresh — httpOnly cookie или отдельная таблица |
| Хеширование паролей | **bcrypt** (rounds 12) | Стандарт для паролей |
| Валидация | **Zod** | Единообразие с фронтом, схемы для body/query |
| Чат (real-time) | **Socket.io** | Соответствие фронту (socket.io-client) |
| AI (локально) | **Ollama** (DeepSeek 7B) | Бесплатный тир; вызов через HTTP к localhost:11434 только с сервера |
| Cron / воркеры | **node-cron** или **Bull/BullMQ** (Redis) | Рекомендации каждые 5–10 мин; при наличии Redis — очередь задач |
| Логирование | **pino** или **winston** | Структурированные логи для продакшена |
| Переменные окружения | **dotenv** | .env для локальной разработки |

**Не в MVP:** Next.js API (если выбран Express), Redis (можно обойтись node-cron без очередей), платные AI-провайдеры.

---

## 2. Структура проекта

```
edmission-beckend/
├── prisma/
│   ├── schema.prisma      # Модели, индексы
│   ├── migrations/
│   └── seed.ts            # Опционально: тестовые данные
├── src/
│   ├── index.ts           # Точка входа: Express + Socket.io server
│   ├── app.ts             # Express app (middlewares, routes)
│   ├── config/
│   │   ├── index.ts       # env, constants
│   │   └── database.ts    # Prisma client singleton
│   ├── controllers/
│   │   ├── auth.controller.ts
│   │   ├── student.controller.ts
│   │   ├── university.controller.ts
│   │   ├── admin.controller.ts
│   │   ├── chat.controller.ts   # REST для истории сообщений
│   │   ├── ai.controller.ts
│   │   └── notification.controller.ts
│   ├── services/
│   │   ├── auth.service.ts
│   │   ├── student.service.ts
│   │   ├── university.service.ts
│   │   ├── admin.service.ts
│   │   ├── matching.service.ts   # Расчёт match_score
│   │   ├── chat.service.ts
│   │   ├── ai.service.ts         # Ollama/OpenAI вызовы
│   │   ├── notification.service.ts
│   │   ├── email.service.ts      # Верификация, forgot password
│   │   └── storage.service.ts    # Загрузка файлов: аватар, лого, фото кампуса
│   ├── repositories/            # Опционально: слой доступа к БД поверх Prisma
│   │   ├── user.repository.ts
│   │   ├── recommendation.repository.ts
│   │   └── ...
│   ├── middlewares/
│   │   ├── auth.middleware.ts    # JWT verify, attach user
│   │   ├── rbac.middleware.ts    # requireRole('student' | 'university' | 'admin')
│   │   ├── validate.middleware.ts # Zod schema per route
│   │   ├── rateLimit.middleware.ts
│   │   ├── errorHandler.middleware.ts
│   │   └── socketAuth.middleware.ts
│   ├── routes/
│   │   ├── index.ts              # Сводка всех роутов
│   │   ├── auth.routes.ts
│   │   ├── student.routes.ts
│   │   ├── university.routes.ts
│   │   ├── admin.routes.ts
│   │   ├── chat.routes.ts
│   │   ├── ai.routes.ts
│   │   └── notification.routes.ts
│   ├── validators/
│   │   ├── auth.validator.ts
│   │   ├── student.validator.ts
│   │   ├── university.validator.ts
│   │   └── ...
│   ├── workers/
│   │   ├── recommendation.worker.ts  # Cron: пересчёт recommendations
│   │   └── index.ts                  # Запуск воркеров (или отдельный процесс)
│   ├── ai/
│   │   ├── ollama.client.ts      # HTTP к Ollama API
│   │   ├── context.builder.ts    # Сбор контекста для промпта (GPA, offers, pipeline)
│   │   └── prompts.ts           # Системные промпты по ролям
│   ├── socket/
│   │   ├── index.ts             # Инициализация Socket.io
│   │   ├── chat.handlers.ts     # join room, send message, read receipt
│   │   └── notification.handlers.ts
│   ├── utils/
│   │   ├── jwt.ts
│   │   ├── errors.ts            # AppError, error codes
│   │   └── logger.ts
│   └── types/
│       ├── express.d.ts          # Расширение Request (user, role)
│       └── api.types.ts
├── tests/                        # Опционально: unit/integration
│   ├── auth.test.ts
│   └── ...
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 3. База данных (Prisma schema)

### 3.1 Перечисляемые типы (enums)

```prisma
enum Role {
  student
  university
  admin
}

enum InterestStatus {
  interested
  under_review
  chat_opened
  offer_sent
  rejected
  accepted
}

enum OfferStatus {
  pending
  accepted
  declined
}

enum NotificationType {
  offer
  message
  status_update
}
```

### 3.2 Таблицы

**users**

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | uuid | PK, default uuid() |
| role | Role | |
| email | String | unique |
| password_hash | String | |
| email_verified | Boolean | default false |
| suspended | Boolean | default false (для админа) |
| created_at | DateTime | |
| updated_at | DateTime | |

Индексы: `email`, `role`.

---

**student_profiles**

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | uuid | PK |
| user_id | uuid | FK users, unique |
| first_name | String? | |
| last_name | String? | |
| birth_date | DateTime? | |
| country | String? | |
| grade_level | String? | |
| gpa | Decimal? | |
| language_level | String? | |
| bio | String? | |
| avatar_url | String? | |
| portfolio_completion_percent | Int | default 0 |
| needs_recalculation | Boolean | default true |
| created_at | DateTime | |
| updated_at | DateTime | |

Индексы: `user_id`, `gpa`, `grade_level`, `country`.

---

**university_profiles**

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | uuid | PK |
| user_id | uuid | FK users, unique |
| university_name | String | |
| tagline | String? | |
| established_year | Int? | |
| student_count | Int? | |
| country | String? | |
| city | String? | |
| description | String? | |
| logo_url | String? | |
| verified | Boolean | default false |
| onboarding_completed | Boolean | default false |
| needs_recalculation | Boolean | default true |
| created_at | DateTime | |
| updated_at | DateTime | |

Дополнительно (по блюпринту): campus_photos (JSON array URL?), video_tour_url?, map_location?, housing_info?, clubs?, facilities?, student_support?, email?, phone?, social_links (JSON?). Либо вынести в отдельные поля, либо один JSON `extra` — на выбор.

Индексы: `user_id`, `country`, `city`, `verified`.

---

**programs**

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | uuid | PK |
| university_id | uuid | FK university_profiles |
| name | String | |
| degree_level | String | |
| field | String | |
| duration_years | Decimal? | |
| tuition_fee | Decimal? | |
| language | String? | |
| entry_requirements | String? | |
| created_at | DateTime | |
| updated_at | DateTime | |

Индексы: `university_id`, `degree_level`, `field`.

---

**scholarships**

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | uuid | PK |
| university_id | uuid | FK university_profiles |
| name | String | |
| coverage_percent | Int | |
| max_slots | Int | |
| remaining_slots | Int | |
| deadline | DateTime? | |
| eligibility | String? | |
| created_at | DateTime | |
| updated_at | DateTime | |

Индексы: `university_id`, `deadline`.

---

**interests**

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | uuid | PK |
| student_id | uuid | FK student_profiles |
| university_id | uuid | FK university_profiles |
| status | InterestStatus | default interested |
| created_at | DateTime | |
| updated_at | DateTime | |

Уникальность: пара (student_id, university_id) — один интерес на пару. Индексы: `student_id`, `university_id`, `status`.

---

**offers**

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | uuid | PK |
| student_id | uuid | FK student_profiles |
| university_id | uuid | FK university_profiles |
| scholarship_id | uuid? | FK scholarships |
| coverage_percent | Int | |
| status | OfferStatus | default pending |
| deadline | DateTime? | |
| created_at | DateTime | |
| updated_at | DateTime | |

Индексы: `student_id`, `university_id`, `status`.

---

**chats**

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | uuid | PK |
| student_id | uuid | FK student_profiles |
| university_id | uuid | FK university_profiles |
| created_at | DateTime | |
| updated_at | DateTime | |

Уникальность: (student_id, university_id). Индексы: `student_id`, `university_id`.

---

**messages**

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | uuid | PK |
| chat_id | uuid | FK chats |
| sender_id | uuid | FK users |
| message | String | text |
| is_read | Boolean | default false |
| created_at | DateTime | |

Индексы: `chat_id`, `created_at`.

---

**recommendations**

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | uuid | PK |
| student_id | uuid | FK student_profiles |
| university_id | uuid | FK university_profiles |
| match_score | Float | 0–1 |
| breakdown | Json? | { fieldMatch, gpa, language, tuitionFit, scholarshipFit, location } |
| updated_at | DateTime | |

Уникальность: (student_id, university_id). Индексы: `student_id`, `(student_id, match_score DESC)`, `university_id` для обратного поиска (рекомендации для вуза по студентам).

---

**notifications**

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | uuid | PK |
| user_id | uuid | FK users |
| type | NotificationType | |
| title | String? | |
| body | String? | |
| reference_id | uuid? | offer_id / chat_id / interest_id |
| read_at | DateTime? | |
| created_at | DateTime | |

Индексы: `user_id`, `read_at`, `created_at`.

---

**activity_logs** (аудит для админа)

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | uuid | PK |
| user_id | uuid? | FK users |
| action | String | |
| resource | String? | |
| resource_id | uuid? | |
| metadata | Json? | |
| ip | String? | |
| created_at | DateTime | |

Индексы: `user_id`, `action`, `created_at`.

---

**university_documents** (для верификации админом)

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | uuid | PK |
| university_id | uuid | FK university_profiles |
| document_type | String | |
| file_url | String | |
| status | String? | pending / approved / rejected |
| reviewed_by | uuid? | FK users (admin) |
| reviewed_at | DateTime? | |
| created_at | DateTime | |

Индексы: `university_id`, `status`.

---

**refresh_tokens** (если храним refresh в БД вместо cookie)

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | uuid | PK |
| user_id | uuid | FK users |
| token | String | unique, hashed |
| expires_at | DateTime | |
| created_at | DateTime | |

Индексы: `user_id`, `token`, `expires_at`.

---

## 4. API (REST)

Базовый префикс: `/api`. Все защищённые роуты: заголовок `Authorization: Bearer <access_token>`.

### 4.1 Auth — `/api/auth`

| Метод | Путь | Описание | Доступ |
|-------|------|----------|--------|
| POST | /register | Регистрация (body: email, password, role) | Public |
| POST | /login | Логин (email, password) → access + refresh | Public |
| POST | /logout | Инвалидация refresh (если в БД) | Auth |
| POST | /refresh | Обмен refresh на новый access | Public (cookie/body) |
| GET | /me | Текущий пользователь + профиль по роли | Auth |
| POST | /forgot-password | Запрос сброса (email) → отправка письма | Public |
| POST | /reset-password | Новый пароль (token, newPassword) | Public |
| GET | /verify-email | Подтверждение по token (query) | Public |
| POST | /verify-email/resend | Повторная отправка письма | Auth |

### 4.2 Student — `/api/student`

| Метод | Путь | Описание | Доступ |
|-------|------|----------|--------|
| GET | /profile | Профиль студента | Student |
| PATCH | /profile | Обновление профиля | Student |
| GET | /dashboard | Сводка: рекомендации топ-5, заявки, офферы, чаты, метрики | Student |
| GET | /universities | Список вузов (фильтры, сортировка, пагинация) | Student |
| GET | /universities/:id | Детали вуза | Student |
| POST | /universities/:id/interest | Создать/обновить интерес | Student |
| GET | /applications | Список интересов (заявок) студента | Student |
| GET | /offers | Офферы студента | Student |
| POST | /offers/:id/accept | Принять оффер | Student |
| POST | /offers/:id/decline | Отклонить оффер | Student |
| GET | /recommendations | Рекомендации (match_score DESC) | Student |
| GET | /compare | Данные для сравнения (ids в query) | Student |

### 4.3 University — `/api/university`

| Метод | Путь | Описание | Доступ |
|-------|------|----------|--------|
| GET | /profile | Профиль университета | University |
| PUT | /profile | Обновление профиля (в т.ч. онбординг) | University |
| GET | /dashboard | Метрики, воронка, последние студенты | University |
| GET | /students | Discovery: студенты с фильтрами и match | University |
| GET | /pipeline | Студенты по статусам (interests) для Kanban | University |
| PATCH | /interests/:id | Смена статуса заявки (under_review, offer_sent, rejected, accepted) | University |
| GET | /scholarships | Стипендии вуза | University |
| POST | /scholarships | Создать стипендию | University |
| PATCH | /scholarships/:id | Редактировать стипендию | University |
| DELETE | /scholarships/:id | Удалить (если нет активных офферов) | University |
| POST | /offers | Создать оффер студенту (student_id, scholarship_id, coverage, deadline) | University |
| GET | /analytics | Данные для графиков (интерес, конверсия, регионы, стипендии) | University |
| GET | /recommendations | Рекомендации «студенты для вуза» (обратный match) | University |

Программы: часть профиля (вложенный объект в PUT /profile) или отдельные CRUD `/api/university/programs` — на выбор.

### 4.4 Admin — `/api/admin`

| Метод | Путь | Описание | Доступ |
|-------|------|----------|--------|
| GET | /dashboard | Сводка: пользователи, вузы, офферы, health | Admin |
| GET | /users | Список пользователей (фильтр по роли, пагинация) | Admin |
| PATCH | /users/:id/suspend | Заблокировать/разблокировать | Admin |
| GET | /universities/verification | Очередь на верификацию | Admin |
| POST | /universities/:id/verify | Approve/Reject верификация | Admin |
| GET | /scholarships | Мониторинг стипендий по вузам | Admin |
| GET | /logs | Activity logs (фильтры) | Admin |
| GET | /health | Состояние API, БД, воркеров (если есть) | Admin |

Support tickets — при появлении сущности на бэке: CRUD в админке.

### 4.5 Chat — `/api/chat`

| Метод | Путь | Описание | Доступ |
|-------|------|----------|--------|
| GET | / | Список чатов текущего пользователя | Auth |
| GET | /:chatId/messages | История сообщений (пагинация) | Auth (участник чата) |
| POST | /:chatId/read | Пометить сообщения прочитанными | Auth |

Отправка сообщений — через Socket.io, не REST. При отправке сокета — сохранять в БД и эмитить в комнату.

### 4.6 AI — `/api/ai`

| Метод | Путь | Описание | Доступ |
|-------|------|----------|--------|
| POST | /chat | Body: { message }. Контекст собирается на бэке (GPA, offers, pipeline). Ответ от Ollama/OpenAI | Auth |

Rate limit: например, N запросов в минуту на пользователя.

### 4.7 Notifications — `/api/notifications`

| Метод | Путь | Описание | Доступ |
|-------|------|----------|--------|
| GET | / | Список уведомлений (пагинация, непрочитанные первые) | Auth |
| PATCH | /:id/read | Пометить прочитанным | Auth |
| PATCH | /read-all | Пометить все прочитанными | Auth |

---

## 5. Аутентификация и RBAC

### 5.1 JWT

- **Access token:** короткий TTL (15–30 мин), в теле ответа логина и в заголовке запросов.
- **Refresh token:** длинный TTL (7–14 дней). Варианты:
  - httpOnly cookie (безопаснее, не доступен из JS);
  - либо хранение в БД (refresh_tokens) и передача в теле — тогда фронт хранит в памяти или кратко в storage по политике.

Подпись: секрет из env (JWT_SECRET). В payload: `sub` (user_id), `role`, `email` (опционально).

### 5.2 Middleware

1. **auth:** проверка JWT, извлечение user_id и role, присоединение к `req.user`. При невалидном/истёкшем — 401.
2. **rbac(['student', 'university', 'admin']):** после auth проверять `req.user.role` в списке разрешённых; иначе 403.
3. **validate(schema):** body/query/params через Zod; при ошибке — 400 с перечнем полей.

### 5.3 Email verification

- При регистрации: генерация токена (uuid или JWT с коротким TTL), ссылка в письме `GET /api/auth/verify-email?token=...`.
- Эндпоинт проверяет токен, ставит `email_verified = true`, редирект или JSON success.
- Для защищённых действий при необходимости проверять `email_verified` (middleware или в сервисах).

### 5.4 Forgot password

- POST /forgot-password: генерация токена, сохранение в таблице (например, user.reset_token, user.reset_token_expires) или отдельная таблица.
- Письмо со ссылкой на сброс (на фронт с token в query).
- POST /reset-password: token + newPassword; проверка, хеш нового пароля, очистка токена.

---

## 6. Matching Engine

### 6.1 Формула (нормализация 0–1)

Параметры (пример весов, настраиваемые):

- **field_match:** совпадение направления студента и программ вуза (0 или 1, либо доля совпадений).
- **gpa:** нормализация GPA по шкале вуза/глобальной (min–max или пороги).
- **language:** совпадение языка обучения и level студента.
- **tuition_fit:** бюджет студента vs tuition (если есть поле «макс. платёж» в профиле).
- **scholarship_fit:** наличие подходящей стипендии и соответствие eligibility.
- **location:** страна/город студента и вуза.

Итог: `score = Σ (weight_i * parameter_i)`, веса в сумме 1. Сохранять в `recommendations.breakdown` по факторам для прозрачности.

### 6.2 Cron Worker

- Интервал: каждые 5–10 минут (node-cron или отдельный скрипт).
- Шаги:
  1. Выбрать студентов с `needs_recalculation = true` (и при первом заполнении профиля).
  2. Для каждого студента: получить список вузов (с фильтром по verified, при необходимости).
  3. Для каждой пары (student, university) посчитать score и breakdown.
  4. Upsert в `recommendations` (по student_id, university_id).
  5. Установить `needs_recalculation = false` у студента.
- При обновлении профиля студента или добавлении программ/стипендий вуза — выставлять флаги `needs_recalculation` у затронутых студентов/вузов.

### 6.3 Обратный match (для университета)

Рекомендации «топ студентов для вуза»: те же `recommendations`, отфильтрованные по `university_id`, сортировка по `match_score DESC`. Либо дублировать расчёт в обратную сторону и хранить в отдельной таблице — по решению (для MVP достаточно одной таблицы и фильтра по university_id).

---

## 7. AI (Ollama + контекст)

### 7.1 Безопасность

- Порт Ollama (11434) не открыт наружу; только backend делает запросы к `http://localhost:11434/api/chat` (или аналог).
- Контекст для промпта формируется на бэке: данные из БД (GPA, офферы, статусы заявок, список рекомендаций) без сырых паролей и токенов.

### 7.2 POST /api/ai/chat

1. Валидация JWT, извлечение user_id и role.
2. Сервис собирает контекст (student: GPA, топ рекомендаций, офферы; university: воронка, стипендии).
3. Сборка system prompt (роль + контекст) и user message.
4. Запрос к Ollama (или при наличии — к OpenAI для премиума). Таймаут ответа (например, 30 с).
5. Ответ стримировать или вернуть одним блоком (по возможностям Ollama API).
6. Rate limit: например, 10 запросов в минуту на пользователя.

### 7.3 Модель

- Локально: `deepseek:7b` (или актуальная модель в Ollama).
- Промпты хранить в `ai/prompts.ts` (системный шаблон по роли студент/университет).

---

## 8. Чат (Socket.io)

### 8.1 Подключение

- Клиент подключается с query/header с access token (или отправляет событие auth после подключения).
- Middleware: проверка JWT, при успехе — привязка socket к user_id и role.

### 8.2 Комнаты

- Комната = `chat:{chatId}`. Участники: студент и представитель вуза (user_id университета).
- При открытии чата клиент эмитит `join_chat`, сервер проверяет, что пользователь — участник этого чата, затем socket.join(`chat:${chatId}`).

### 8.3 События

- **send_message:** body { chatId, message }. Сервер: проверка прав, сохранение в `messages`, эмит в комнату `chat:${chatId}` события `new_message` (payload: сообщение + sender). Создание уведомления для получателя (type: message).
- **mark_read:** body { chatId } или { messageIds }. Обновление `is_read` в БД, эмит в комнату `messages_read` (опционально).
- **typing:** body { chatId }. Эмит в комнату `user_typing` (для индикатора на фронте).

### 8.4 История

- Загрузка истории — через REST GET /api/chat/:chatId/messages (пагинация). Сокет используется только для новых сообщений и статусов.

---

## 9. Уведомления

### 9.1 Создание

- При создании оффера → notification для студента (type: offer, reference_id: offer_id).
- При новом сообщении в чате → notification для второго участника (type: message, reference_id: chat_id).
- При смене статуса interest (например, offer_sent) → notification для студента (type: status_update).

### 9.2 Доставка

- Запись в таблицу `notifications`.
- При наличии Socket.io: при создании уведомления эмит в личную комнату пользователя `user:${userId}` событие `notification` (payload: объект уведомления). Клиент подписан на эту комнату после авторизации сокета.

---

## 10. Файлы и медиа

- Загрузка: аватар студента, лого вуза, фото кампуса, документы вуза (для верификации).
- Варианты: локальная папка (например, `uploads/`) с раздачей через Express static или отдельный домен; либо S3-совместимое хранилище (MinIO, AWS S3).
- Безопасность: проверка типа файла, размера, прав (только свой профиль/вуз). Имена файлов — uuid + расширение, URL сохранять в БД.

---

## 11. Безопасность и качество

- **Rate limiting:** по IP для auth (login, register, forgot-password); по user_id для /api/ai/chat и тяжёлых эндпоинтов. Пакет: express-rate-limit.
- **CORS:** whitelist origin фронта из env.
- **Helmet:** базовые заголовки безопасности.
- **Валидация:** все входящие данные через Zod; санитизация строк при необходимости.
- **Аудит:** логирование критичных действий (логин, смена роли, верификация вуза, блокировка пользователя) в `activity_logs` с user_id, action, resource, IP.
- **Логи:** не логировать пароли и токены; структурированный лог (pino) для продакшена.

---

## 12. Развёртывание

- **Процессы:** API (Express + Socket.io), отдельно — воркер рекомендаций (cron). При использовании Redis — опционально очередь для расчёта рекомендаций.
- **PM2:** конфиг с двумя приложениями (api, worker) или один процесс с воркером в том же процессе (проще для старта).
- **Env:** NODE_ENV, DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET (если отдельный), CORS_ORIGIN, OLLAMA_BASE_URL (по умолчанию http://localhost:11434), порты API и т.д.
- **Миграции:** перед стартом `npx prisma migrate deploy`. Seed — только для dev/staging при необходимости.

---

## 13. Этапы реализации

### Фаза 0 — Основа

1. Инициализация проекта (Node, TypeScript, Express).
2. Prisma: schema (все таблицы выше), миграции, базовые модели.
3. Конфиг: env, логгер, централизованный обработчик ошибок.
4. Middlewares: auth (JWT), rbac, validate (Zod), rate limit, CORS, Helmet.
5. Роуты: структура папок, подключение в app.

### Фаза 1 — Auth и профили

6. Auth: register, login, refresh, logout, me; bcrypt, JWT access/refresh; email verification (токен + endpoint + письмо заглушка или Nodemailer); forgot/reset password.
7. Student: GET/PATCH profile, расчёт portfolio_completion_percent, вызов установки needs_recalculation при обновлении профиля.
8. University: GET/PUT profile (онбординг одним или несколькими запросами), программы и стипендии как часть профиля или отдельные сущности.
9. Admin: GET /users, PATCH suspend; базовая проверка роли admin.

### Фаза 2 — Рекомендации и интересы

10. Matching service: формула score, нормализация параметров, запись breakdown.
11. Recommendation worker: cron каждые 5–10 мин, выбор студентов с needs_recalculation, расчёт и upsert recommendations.
12. Student: GET /recommendations, GET /universities (с фильтрами и сортировкой по match при наличии), GET /universities/:id, POST interest.
13. University: GET /students (discovery с рекомендациями по university_id), GET /pipeline (interests по статусам), PATCH interest (смена статуса).
14. Индексы и пагинация на всех списках.

### Фаза 3 — Офферы и стипендии

15. Scholarships: CRUD для университета; проверка слотов (remaining_slots) при создании оффера.
16. Offers: создание оффера (университет), список для студента, accept/decline; обновление remaining_slots и статусов; уведомления при создании и при accept/decline.
17. Admin: мониторинг стипендий (read-only список по вузам).

### Фаза 4 — Чат и уведомления

18. Chats: создание чата при первом сообщении (если чата нет); сохранение сообщений в БД.
19. Socket.io: сервер, auth middleware, комнаты по chatId, события send_message, mark_read, typing; эмит new_message в комнату и создание notification.
20. REST: GET /chat, GET /chat/:chatId/messages, POST /chat/:chatId/read.
21. Notifications: создание при оффере, сообщении, смене статуса; GET и PATCH read; эмит в сокет в комнату user:${userId}.

### Фаза 5 — AI и админ

22. AI: Ollama client, context builder (студент/университет), POST /api/ai/chat с rate limit и таймаутом.
23. Admin: dashboard (агрегаты по пользователям, вузам, офферам); верификация вузов (очередь, approve/reject); activity logs (GET с фильтрами); GET /health (БД, при необходимости Ollama).

### Фаза 6 — Полировка

24. Загрузка файлов: аватар, лого, фото кампуса, документы вуза; хранение URL в профилях и university_documents.
25. Email: нормальная отправка (Nodemailer + SMTP или сервис); шаблоны verify, reset password.
26. Документация: описание API (OpenAPI/Swagger или markdown).
27. Тесты: критичные сценарии (auth, создание interest, оффер, сообщение) — по желанию.

---

## 14. Зависимости от фронта

- Формат ответов: JSON; пагинация (page, limit, total); коды ошибок (400, 401, 403, 404, 429, 500) и единый формат тела ошибки (message, code, errors).
- Сокет: события и форматы payload должны совпадать с фронтом (см. план фронтенда).
- Токены: способ передачи refresh (cookie vs body) согласовать с фронтом.

---

## 15. Чеклист перед стартом

- [ ] Утвердить план и объём фаз.
- [ ] Выбрать способ хранения refresh token (cookie vs DB).
- [ ] Поднять PostgreSQL, создать БД и прописать DATABASE_URL.
- [ ] При необходимости — установить Ollama и модель для фазы AI.
- [ ] Завести .env.example и описать все переменные.

План готов к использованию для пошаговой реализации бэкенда Edmission. После утверждения можно переходить к Фазе 0.
