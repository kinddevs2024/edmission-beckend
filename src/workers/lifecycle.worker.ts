import cron from 'node-cron';
import { logger } from '../utils/logger';
import { expireOffersNow } from '../services/offerExpiration.service';
import { expireStudentDocumentsNow } from '../services/documents.service';

const CRON_SCHEDULE = '*/10 * * * *';

export function startLifecycleWorker(): void {
  cron.schedule(CRON_SCHEDULE, async () => {
    try {
      const [offersResult, documentsResult] = await Promise.all([
        expireOffersNow(),
        expireStudentDocumentsNow(),
      ]);
      logger.info(
        {
          expiredOffers: offersResult.processed,
          expiredDocuments: documentsResult.processed,
        },
        'Lifecycle worker tick completed'
      );
    } catch (error) {
      logger.error(error, 'Lifecycle worker tick failed');
    }
  });
}
