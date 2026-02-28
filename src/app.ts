import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { errorHandler } from './middlewares/errorHandler.middleware';
import routes from './routes';
import { swaggerSpec } from './swagger';

const app = express();

app.use(helmet());
app.use(cors({ origin: config.cors.origin, credentials: true }));
app.use(cookieParser());
app.use(express.json());

/** Единый обработчик health: JSON со статусом и IP */
function healthHandler(
  req: express.Request,
  res: express.Response
): void {
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    '';
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ip,
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
