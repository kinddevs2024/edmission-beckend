import mongoose from 'mongoose';

const telegramAuthSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    telegramId: { type: Number },
    telegramUsername: { type: String, default: '' },
    name: { type: String, default: '' },
    phone: { type: String, default: '' },
    code: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

telegramAuthSessionSchema.index({ sessionId: 1 }, { unique: true });
telegramAuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
telegramAuthSessionSchema.index({ telegramId: 1 });

export const TelegramAuthSession = mongoose.model('TelegramAuthSession', telegramAuthSessionSchema);
