import http from 'http';
import { config } from './config';
import { connectDatabase } from './config/database';
import app from './app';
import { initSocket } from './socket';
import { startRecommendationWorker } from './workers/recommendation.worker';
import { startLifecycleWorker } from './workers/lifecycle.worker';
import { logger } from './utils/logger';
import * as aiProvider from './ai/provider';
import { ensureDefaultAdmin } from './services/auth.service';
import { startTelegramBotPolling } from './services/telegramBot.service';
import { PERIMETER_SECURITY_NPM_PACKAGES } from './middlewares/perimeter.middleware';

const httpServer = http.createServer(app);

initSocket(httpServer);

let dbReady = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let workersStarted = false;
let reconnectInProgress = false;

async function initializeAfterDbConnected() {
  if (!dbReady) {
    await ensureDefaultAdmin();
    logger.info('Default admin ensured');
    dbReady = true;
  }

  // Start workers once after first successful DB connection.
  if (!workersStarted && config.nodeEnv !== 'test') {
    startRecommendationWorker();
    startLifecycleWorker();
    workersStarted = true;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const retryEveryMs = 15000;
  reconnectTimer = setInterval(async () => {
    if (reconnectInProgress) return;
    reconnectInProgress = true;
    try {
      await connectDatabase();
      logger.info('Database reconnected in background');
      await initializeAfterDbConnected();
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
    } catch (e) {
      logger.warn(e, 'Background DB reconnect failed; will keep retrying');
    } finally {
      reconnectInProgress = false;
    }
  }, retryEveryMs);
  logger.warn({ retryEveryMs }, 'Background DB reconnect loop started');
}

async function start() {

  // Сначала слушаем порт — чтобы бэкенд сразу отвечал на /api/* (в т.ч. /api/health, /api/auth/register).
  // Иначе при долгом или неудачном подключении к MongoDB сервер не слушал бы и фронт получал бы таймаут.
  httpServer.listen(config.port, config.host, () => {
    logger.info({ port: config.port, host: config.host }, 'Server listening');
    logger.info(
      { perimeterNpm: [...PERIMETER_SECURITY_NPM_PACKAGES] },
      'External HTTP protection: npm packages active (see app.ts + perimeter.middleware.ts)'
    );
  });
  startTelegramBotPolling();

  try {
    await connectDatabase();
    logger.info('Database connected');
    await initializeAfterDbConnected();
  } catch (e) {
    logger.error(e, 'Database connection failed — server keeps listening; /api/health works, auth/register will return 503 until MongoDB is up');
    // Do not exit: keep API up and reconnect DB in background when network returns.
    scheduleReconnect();
  }

  if (aiProvider.useOpenAI()) {
    logger.info({ model: aiProvider.getModelName() }, 'OpenAI (ChatGPT) — AI assistant ready');
  } else if (aiProvider.useGemini()) {
    logger.info({ model: aiProvider.getModelName() }, 'Gemini — AI assistant ready');
  } else if (aiProvider.useDeepSeek()) {
    aiProvider.healthCheck().then((ok) => {
      if (ok) logger.info({ model: aiProvider.getModelName() }, 'DeepSeek API — AI assistant ready');
      else logger.warn('DeepSeek API key set but health check failed');
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
  if (reconnectTimer) clearInterval(reconnectTimer);
  httpServer.close();
  process.exit(0);
});
