import mongoose from 'mongoose';

const schema = new mongoose.Schema(
  {
    email: { type: String, required: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, enum: ['student', 'university'] },
    avatarUrl: String,
    verifyToken: { type: String, required: true },
    verifyTokenExpires: { type: Date, required: true },
    verifyTokenSentAt: { type: Date, required: true },
    verifyFailedAttempts: { type: Number, default: 0 },
    verifyLockedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

schema.index({ email: 1 }, { unique: true });
schema.index({ verifyTokenExpires: 1 }, { expireAfterSeconds: 0 }); // TTL: auto-delete expired

export const PendingRegistration = mongoose.model('PendingRegistration', schema);
