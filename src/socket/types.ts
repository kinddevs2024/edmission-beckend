import { Socket } from 'socket.io';
import type { Role } from '@prisma/client';

export interface SocketUser {
  id: string;
  email: string;
  role: Role;
}

export interface ExtendedSocket extends Socket {
  user?: SocketUser;
}
