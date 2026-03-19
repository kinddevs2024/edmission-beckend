import type { Role } from './role';
import type { ApiLocale } from '../i18n/apiMessages';

declare global {
  namespace Express {
    interface Request {
      locale?: ApiLocale;
      user?: {
        id: string;
        email: string;
        role: Role;
        language?: ApiLocale;
      };
    }
  }
}

export {};
