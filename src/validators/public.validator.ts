import { z } from 'zod';

/** Site visit beacon — was unbounded strings (DB spam / abuse). */
export const trackSiteVisitSchema = z
  .object({
    visitorId: z.string().min(1).max(128),
    path: z.string().max(512).optional(),
  })
  .strict();

/** Trusted logos pagination — cap page size (DoS / heavy reads). */
export const trustedLogosQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).max(50_000).optional(),
});

/** Public university catalog pagination for landing/explore pages. */
export const publicUniversitiesQuerySchema = z.object({
  page: z.coerce.number().min(1).max(50_000).optional(),
  limit: z.coerce.number().min(1).max(50).optional(),
});
