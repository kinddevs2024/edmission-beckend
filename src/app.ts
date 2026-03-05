import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { errorHandler } from './middlewares/errorHandler.middleware';
import routes from './routes';
import { swaggerSpec } from './swagger';
import * as aiProvider from './ai/provider';

const app = express();

// Disable default CSP that blocks eval(); some libs (e.g. Swagger UI, dev tools) use it.
// To re-enable CSP, set contentSecurityPolicy with explicit directives instead of false.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(cookieParser());
app.use(express.json({
  verify: (req: express.Request, _res, buf: Buffer) => {
    if (req.originalUrl === '/api/payment/webhook') (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  },
}));

/** Единый обработчик health: JSON со статусом, IP и AI provider */
function healthHandler(
  req: express.Request,
  res: express.Response
): void {
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    '';
  const aiProviderName = aiProvider.useOpenAI() ? 'openai' : aiProvider.useGemini() ? 'gemini' : aiProvider.useDeepSeek() ? 'deepseek' : 'ollama';
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ip,
    aiProvider: aiProviderName,
    aiModel: aiProvider.getModelName(),
  });
}

/** Health на корне (для прямого доступа по IP:4000/health) */
app.get('/health', healthHandler);

/** Health под /api (фронт дергает /api/health через baseURL /api) */
app.get('/api/health', healthHandler);

/** Проверка: бэкенд отвечает на любой /api (фронт шлёт на /api/auth/register и т.д.) */
app.get('/api', (_req, res) => {
  res.json({ ok: true, message: 'Edmission API', paths: ['/api/health', '/api/auth/register', '/api/auth/login', '/api/auth/me'] });
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

app.use('/api', routes);

app.use(errorHandler);

export default app;
