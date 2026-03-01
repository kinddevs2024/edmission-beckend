import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { socketAuthMiddleware } from '../middlewares/socketAuth.middleware';
import { registerChatHandlers } from './chat.handlers';
import { registerNotificationHandlers } from './notification.handlers';
import { logger } from '../utils/logger';

let ioInstance: Server | null = null;

export function getIO(): Server | null {
  return ioInstance;
}

export function initSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) || ['http://localhost:3000'],
    },
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    logger.debug({ socketId: socket.id, user: (socket as import('./types').ExtendedSocket).user?.id }, 'Socket connected');
  });

  registerChatHandlers(io);
  registerNotificationHandlers(io);

  ioInstance = io;
  return io;
}
