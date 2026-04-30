/**
 * Inbound / perimeter stack (npm): helmet, cors, compression, cookie-parser,
 * express-rate-limit, express-slow-down, connect-timeout (when apiRequestTimeoutMs > 0),
 * express-mongo-sanitize, hpp, zod (per-route), bcrypt (secrets). See `perimeter.middleware.ts`
 * and SECURITY.md.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { createCorsOriginDelegate } from './config/corsPolicy';
import { errorHandler } from './middlewares/errorHandler.middleware';
import { apiLocaleMiddleware } from './middlewares/apiLocale.middleware';
import { apiSlowDown, apiRequestTimeoutMiddleware } from './middlewares/perimeter.middleware';
import routes from './routes';
import { swaggerSpec } from './swagger';
import { globalApiRateLimiter } from './middlewares/rateLimit.middleware';
import { mongoInjectionSanitizer } from './middlewares/mongoSanitize.middleware';
import hpp from 'hpp';

const app = express();

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use(helmet({
  hsts:
    config.nodeEnv === 'production'
      ? { maxAge: 31536000, includeSubDomains: true, preload: false }
      : false,
  contentSecurityPolicy: config.enableSwagger
    ? false
    : {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://accounts.google.com', 'https://apis.google.com', 'https://cdn.jsdelivr.net'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'https:', 'wss:'],
          frameSrc: ["'self'", 'https://accounts.google.com', 'https://*.google.com'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(
  cors({
    origin: createCorsOriginDelegate(config.cors.origin, config.nodeEnv),
    credentials: true,
  })
);
app.use(cookieParser());
app.use(apiRequestTimeoutMiddleware());
if (config.enableResponseCompression) {
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
      },
    })
  );
}
app.use(apiLocaleMiddleware);
app.use('/api', apiSlowDown);
app.use('/api', globalApiRateLimiter);
app.use(express.json({
  limit: config.security.jsonBodyLimit,
  verify: (req: express.Request, _res, buf: Buffer) => {
    if (req.originalUrl === '/api/payment/webhook') (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
  },
}));
app.use(mongoInjectionSanitizer);
/** Last value wins for duplicate query/body keys; reduces HTTP parameter pollution quirks. */
app.use(hpp());

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
