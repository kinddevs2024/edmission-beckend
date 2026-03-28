import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { errorHandler } from './middlewares/errorHandler.middleware';
import { apiLocaleMiddleware } from './middlewares/apiLocale.middleware';
import routes from './routes';
import { swaggerSpec } from './swagger';
import { globalApiRateLimiter } from './middlewares/rateLimit.middleware';

const app = express();

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: config.enableSwagger
    ? false
    : {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'https:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(cookieParser());
app.use(apiLocaleMiddleware);
app.use('/api', globalApiRateLimiter);
app.use(express.json({
  verify: (req: express.Request, _res, buf: Buffer) => {
    if (req.originalUrl === '/api/payment/webhook') (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  },
}));

/** Единый обработчик health: JSON со статусом, IP и AI provider */
function healthHandler(
  _req: express.Request,
  res: express.Response
): void {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
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

if (config.enableSwagger || config.nodeEnv !== 'production') {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));
}

app.use('/api', routes);

app.use(errorHandler);

export default app;
