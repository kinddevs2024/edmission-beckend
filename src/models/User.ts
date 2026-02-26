import mongoose from 'mongoose';

const ROLES = ['student', 'university', 'admin'] as const;

const userSchema = new mongoose.Schema(
  {
    role: { type: String, required: true, enum: ROLES },
    email: { type: String, required: true, unique: true },
    name: { type: String, default: '' },
    passwordHash: { type: String, required: true },
    emailVerified: { type: Boolean, default: false },
    suspended: { type: Boolean, default: false },
    verifyToken: String,
    verifyTokenExpires: Date,
    resetToken: String,
    resetTokenExpires: Date,
  },
  { timestamps: true }
);

userSchema.index({ email: 1 });

export const User = mongoose.model('User', userSchema);
