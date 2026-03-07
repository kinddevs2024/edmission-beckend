import { z } from 'zod';
import { config } from '../config';

function isValidRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const origins = [config.frontendUrl, ...config.cors.origin];
    return origins.some((o) => {
      try {
        return new URL(o).origin === parsed.origin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export const createCheckoutSessionSchema = z.object({
  body: z.object({
    planId: z.string().min(1),
    successUrl: z.string().url().refine(isValidRedirectUrl, 'successUrl must belong to allowed domains'),
    cancelUrl: z.string().url().refine(isValidRedirectUrl, 'cancelUrl must belong to allowed domains'),
  }),
});
