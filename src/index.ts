import http from 'http';
import { config } from './config';
import { connectDatabase } from './config/database';
import app from './app';
import { initSocket } from './socket';
import { startRecommendationWorker } from './workers/recommendation.worker';
import { logger } from './utils/logger';
import * as aiProvider from './ai/provider';
import { ensureDefaultAdmin } from './services/auth.service';

const httpServer = http.createServer(app);

initSocket(httpServer);

if (config.nodeEnv !== 'test') {
  startRecommendationWorker();
}

async function start() {
  // Сначала слушаем порт — чтобы бэкенд сразу отвечал на /api/* (в т.ч. /api/health, /api/auth/register).
  // Иначе при долгом или неудачном подключении к MongoDB сервер не слушал бы и фронт получал бы таймаут.
  httpServer.listen(config.port, config.host, () => {
    logger.info({ port: config.port, host: config.host }, 'Server listening');
  });

  try {
    await connectDatabase();
    logger.info('Database connected');
    await ensureDefaultAdmin();
    logger.info('Default admin ensured');
  } catch (e) {
    logger.error(e, 'Database connection failed — server keeps listening; /api/health works, auth/register will return 503 until MongoDB is up');
    // Не выходим: порт 4000 остаётся слушать, фронт получит ответ на /api/health. Регистрация и т.д. вернут 503, пока не поднимется MongoDB.
  }

  if (aiProvider.useDeepSeek()) {
    aiProvider.healthCheck().then((ok) => {
      if (ok) logger.info({ model: aiProvider.getModelName() }, 'DeepSeek API — AI assistant ready');
      else logger.warn('DeepSeek API key set but health check failed; AI chat may return 503');
    }).catch(() => logger.warn('DeepSeek API health check failed'));
  } else {
    aiProvider.healthCheck().then((ok) => {
      if (ok) logger.info({ model: aiProvider.getModelName() }, 'Ollama reachable — AI chat ready');
      else logger.warn('Ollama not reachable — set DEEPSEEK_API_KEY or start Ollama; AI chat will return 503 until then');
    }).catch(() => logger.warn('Ollama not reachable'));
  }
}

start().catch((e) => {
  logger.error(e, 'Startup failed');
  process.exit(1);
});

process.on('SIGINT', () => {
  httpServer.close();
  process.exit(0);
});
