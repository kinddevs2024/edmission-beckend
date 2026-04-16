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
      /** Set when a university_multi_manager request is delegated to a university account. */
      universityDelegation?: { managerUserId: string };
    }
  }
}

export {};
