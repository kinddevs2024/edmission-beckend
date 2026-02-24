import cron from 'node-cron';
import { runRecommendationWorker } from '../services/matching.service';
import { logger } from '../utils/logger';

const CRON_SCHEDULE = '*/5 * * * *'; // every 5 minutes

export function startRecommendationWorker(): void {
  cron.schedule(CRON_SCHEDULE, async () => {
    try {
      const processed = await runRecommendationWorker();
      if (processed > 0) {
        logger.info({ processed }, 'Recommendation worker run');
      }
    } catch (e) {
      logger.error(e, 'Recommendation worker error');
    }
  });
  logger.info('Recommendation worker scheduled (every 5 min)');
}
