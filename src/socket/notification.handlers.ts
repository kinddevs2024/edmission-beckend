import { Server } from 'socket.io';
import type { ExtendedSocket } from './types';

export function registerNotificationHandlers(io: Server): void {
  io.on('connection', (socket: ExtendedSocket) => {
    if (!socket.user) return;
    socket.join(`user:${socket.user.id}`);
  });
}
