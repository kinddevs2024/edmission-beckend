import { config } from './config';

/** OpenAPI 3.0 спецификация для Swagger UI */
export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Edmission API',
    version: '1.0.0',
    description: 'API бэкенда платформы Edmission — аутентификация, студенты, вузы, чат, админка.',
  },
  servers: [
    { url: `http://localhost:${config.port}`, description: 'Локальный сервер' },
    { url: '/', description: 'Текущий хост (относительный)' },
  ],
  tags: [
    { name: 'Health', description: 'Проверка состояния сервера' },
    { name: 'Auth', description: 'Регистрация, вход, JWT' },
    { name: 'Student', description: 'Профиль студента, заявки' },
    { name: 'University', description: 'Вузы, программы, офферы' },
    { name: 'Admin', description: 'Админ-панель' },
    { name: 'Chat', description: 'Чат с AI' },
    { name: 'AI', description: 'AI endpoints' },
    { name: 'Notifications', description: 'Уведомления' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Проверка здоровья API',
        description: 'Возвращает статус сервера. Используется для health-check (в т.ч. по IP).',
        responses: {
          200: {
            description: 'Сервер работает',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Регистрация',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'role'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', format: 'password' },
                  role: { type: 'string', enum: ['student', 'university'] },
                  name: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: { description: 'Пользователь создан' }, 400: { description: 'Ошибка валидации' } },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Вход',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Успешный вход, cookies + accessToken' }, 401: { description: 'Неверные данные' } },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Текущий пользователь',
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'Профиль пользователя' }, 401: { description: 'Не авторизован' } },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token из cookie или заголовка Authorization',
      },
    },
  },
};
