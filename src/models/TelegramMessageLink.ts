import mongoose from 'mongoose';

const telegramMessageLinkSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    telegramChatId: { type: String, required: true },
    telegramMessageId: { type: Number, required: true },
    appChatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

telegramMessageLinkSchema.index({ telegramChatId: 1, telegramMessageId: 1 }, { unique: true });
telegramMessageLinkSchema.index({ userId: 1, appChatId: 1 });
telegramMessageLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const TelegramMessageLink = mongoose.model('TelegramMessageLink', telegramMessageLinkSchema);
