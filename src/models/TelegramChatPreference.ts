import mongoose from 'mongoose';

const telegramChatPreferenceSchema = new mongoose.Schema(
  {
    telegramChatId: { type: String, required: true, unique: true },
    language: { type: String, enum: ['ru', 'en', 'uz'], default: 'ru' },
    languageSelected: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Index on telegramChatId is already defined with unique: true in the schema field definition


export const TelegramChatPreference = mongoose.model('TelegramChatPreference', telegramChatPreferenceSchema);
