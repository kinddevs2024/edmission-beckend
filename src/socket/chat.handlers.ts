import { Server } from 'socket.io';
import * as chatService from '../services/chat.service';
import type { ExtendedSocket } from './types';

export function registerChatHandlers(io: Server): void {
  io.on('connection', (socket: ExtendedSocket) => {
    if (!socket.user) return;

    socket.on('join_chat', async (payload: { chatId: string }) => {
      const { chatId } = payload || {};
      if (!chatId) return;
      try {
        const chats = await chatService.getChats(socket.user!.id);
        const found = (chats as Array<{ id: string }>).some((c) => c.id === chatId);
        if (found) {
          socket.join(`chat:${chatId}`);
        }
      } catch {
        // ignore
      }
    });

    socket.on('send_message', async (payload: { chatId: string; message?: string; type?: string; attachmentUrl?: string; metadata?: Record<string, unknown> }) => {
      const { chatId, message, type, attachmentUrl, metadata } = payload || {};
      if (!chatId) return;
      const params = type && type !== 'text' ? { type: type as 'voice' | 'emotion', text: message, attachmentUrl, metadata } : (message ?? '').trim();
      if (!params) return;
      if (typeof params === 'string' && !params) return;
      try {
        const { message: msg, recipientId } = await chatService.saveMessage(
          chatId,
          socket.user!.id,
          typeof params === 'string' ? params : params
        );
        const payloadOut = msg as Record<string, unknown>;
        io.to(`chat:${chatId}`).emit('new_message', { chatId, message: { ...payloadOut, id: payloadOut.id ?? payloadOut._id, text: payloadOut.message ?? payloadOut.text } });
        io.to(`user:${recipientId}`).emit('notification', {
          type: 'message',
          title: 'New message',
          referenceId: chatId,
        });
      } catch (e) {
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    socket.on('mark_read', async (payload: { chatId: string }) => {
      const { chatId } = payload || {};
      if (!chatId) return;
      try {
        await chatService.markRead(chatId, socket.user!.id);
        io.to(`chat:${chatId}`).emit('messages_read', { chatId });
      } catch {
        // ignore
      }
    });

    socket.on('typing', (payload: { chatId: string }) => {
      const { chatId } = payload || {};
      if (chatId) {
        socket.to(`chat:${chatId}`).emit('user_typing', { chatId, userId: socket.user!.id });
      }
    });
  });
}
