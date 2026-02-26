import http from 'http';
import { config } from './config';
import { connectDatabase } from './config/database';
import app from './app';
import { initSocket } from './socket';
import { startRecommendationWorker } from './workers/recommendation.worker';
import { logger } from './utils/logger';

const httpServer = http.createServer(app);

initSocket(httpServer);

if (config.nodeEnv !== 'test') {
  startRecommendationWorker();
}

async function start() {
  await connectDatabase();
  httpServer.listen(config.port, config.host, () => {
    logger.info({ port: config.port, host: config.host }, 'Server listening');
  });
}

start().catch((e) => {
  logger.error(e);
  process.exit(1);
});

process.on('SIGINT', () => {
  httpServer.close();
  process.exit(0);
});
