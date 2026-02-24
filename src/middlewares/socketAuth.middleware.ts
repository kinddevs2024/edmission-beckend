import { Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt';
import type { ExtendedSocket } from '../socket/types';

export function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void
): void {
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.query?.token ||
    (Array.isArray(socket.handshake.headers?.authorization)
      ? socket.handshake.headers.authorization[0]?.replace('Bearer ', '')
      : (socket.handshake.headers?.authorization as string)?.replace?.('Bearer ', ''));

  if (!token) {
    next(new Error('Authentication required'));
    return;
  }

  try {
    const payload = verifyAccessToken(token as string);
    (socket as ExtendedSocket).user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
}
