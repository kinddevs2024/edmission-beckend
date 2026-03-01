import mongoose from 'mongoose';

export const MESSAGE_TYPES = ['text', 'voice', 'emotion', 'system'] as const;

const messageSchema = new mongoose.Schema(
  {
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: MESSAGE_TYPES, default: 'text' },
    message: { type: String, default: '' },
    attachmentUrl: { type: String },
    metadata: mongoose.Schema.Types.Mixed,
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

messageSchema.index({ chatId: 1 });
messageSchema.index({ createdAt: 1 });

export const Message = mongoose.model('Message', messageSchema);
