import mongoose from 'mongoose';

const telegramBotSessionSchema = new mongoose.Schema(
  {
    chatId: { type: String, required: true, unique: true },
    lang: { type: String, enum: ['uz', 'ru', 'en'], default: 'en' },
    mode: {
      type: String,
      enum: [
        'idle',
        'await_login_email',
        'await_login_password',
        'await_phone_registration_contact',
        'await_telegram_auth_contact',
        'await_telegram_auth_name',
        'await_telegram_auth_email',
      ],
      default: 'idle',
    },
    pendingEmail: { type: String, default: '' },
    pendingLoginVerifiedContact: { type: Boolean, default: false },
    pendingPhoneRegistrationCode: { type: String, default: '' },
    telegramAuthSessionId: { type: String, default: '' },
    telegramAuthPhone: { type: String, default: '' },
    telegramAuthFirstName: { type: String, default: '' },
    telegramAuthLastName: { type: String, default: '' },
    pendingStartPayload: { type: String, default: '' },
    pendingStartUsername: { type: String, default: '' },
    pendingStartFirstName: { type: String, default: '' },
    pendingStartLastName: { type: String, default: '' },
    username: { type: String, default: '' },
  },
  { timestamps: true }
);

telegramBotSessionSchema.index({ chatId: 1 }, { unique: true });

export const TelegramBotSession = mongoose.model('TelegramBotSession', telegramBotSessionSchema);
