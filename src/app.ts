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

/** IP Health: проверка состояния API, возвращает статус и IP запроса (удобно при проверке по IP). */
app.get('/health', (req, res) => {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ip,
  });
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

app.use('/api', routes);

app.use(errorHandler);

export default app;
