import mongoose from 'mongoose';

const mobileWebAuthSessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

mobileWebAuthSessionSchema.index({ userId: 1 });
mobileWebAuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const MobileWebAuthSession = mongoose.model('MobileWebAuthSession', mobileWebAuthSessionSchema);
