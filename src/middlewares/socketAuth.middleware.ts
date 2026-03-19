import { Socket } from 'socket.io';
import { User } from '../models';
import { resolveApiLocale } from '../i18n/apiMessages';
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
    const handshakeLanguage =
      socket.handshake.auth?.language ||
      socket.handshake.query?.language ||
      socket.handshake.headers['x-user-language'] ||
      socket.handshake.headers['accept-language'];
    const locale = resolveApiLocale(Array.isArray(handshakeLanguage) ? handshakeLanguage[0] : handshakeLanguage);
    (socket as ExtendedSocket).user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      language: locale,
    };
    User.updateOne(
      { _id: payload.sub, language: { $ne: locale } },
      { $set: { language: locale } }
    ).catch(() => {});
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
}
