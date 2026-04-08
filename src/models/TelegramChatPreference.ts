import mongoose from 'mongoose';

const telegramChatPreferenceSchema = new mongoose.Schema(
  {
    telegramChatId: { type: String, required: true, unique: true },
    language: { type: String, enum: ['ru', 'en', 'uz'], default: 'ru' },
    languageSelected: { type: Boolean, default: false },
  },
  { timestamps: true }
);

telegramChatPreferenceSchema.index({ telegramChatId: 1 }, { unique: true });

export const TelegramChatPreference = mongoose.model('TelegramChatPreference', telegramChatPreferenceSchema);
