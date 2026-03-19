import { Socket } from 'socket.io';
import type { ApiLocale } from '../i18n/apiMessages';
import type { Role } from '../types/role';

export interface SocketUser {
  id: string;
  email: string;
  role: Role;
  language?: ApiLocale;
}

export interface ExtendedSocket extends Socket {
  user?: SocketUser;
}
