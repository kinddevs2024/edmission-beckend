import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { socketAuthMiddleware } from '../middlewares/socketAuth.middleware';
import { registerChatHandlers } from './chat.handlers';
import { registerNotificationHandlers } from './notification.handlers';
import { logger } from '../utils/logger';
import { config } from '../config';
import { createCorsOriginDelegate } from '../config/corsPolicy';

let ioInstance: Server | null = null;

export function getIO(): Server | null {
  return ioInstance;
}

export function initSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: createCorsOriginDelegate(config.cors.origin, config.nodeEnv),
      credentials: true,
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
