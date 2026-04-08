import mongoose from 'mongoose';

const pendingPhoneRegistrationSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, enum: ['student', 'university'] },
    name: { type: String, default: '' },
    avatarUrl: { type: String },
    verifyCode: { type: String, required: true },
    verifyCodeExpires: { type: Date, required: true },
    verifiedViaTelegram: { type: Boolean, default: false },
    telegramChatId: { type: String, default: '' },
    telegramUsername: { type: String, default: '' },
    verifiedAt: { type: Date },
  },
  { timestamps: true }
);

pendingPhoneRegistrationSchema.index({ phone: 1 }, { unique: true });
pendingPhoneRegistrationSchema.index({ verifyCode: 1 }, { unique: true });
pendingPhoneRegistrationSchema.index({ verifyCodeExpires: 1 }, { expireAfterSeconds: 0 });

export const PendingPhoneRegistration = mongoose.model('PendingPhoneRegistration', pendingPhoneRegistrationSchema);
