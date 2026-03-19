import mongoose from 'mongoose';

const ROLES = ['student', 'university', 'admin', 'school_counsellor'] as const;
const LANGUAGES = ['en', 'ru', 'uz'] as const;

const userSchema = new mongoose.Schema(
  {
    role: { type: String, required: true, enum: ROLES },
    language: { type: String, enum: LANGUAGES, default: 'en' },
    email: { type: String, required: true, unique: true },
    name: { type: String, default: '' },
    phone: { type: String, default: '' },
    socialLinks: {
      telegram: { type: String, default: '' },
      instagram: { type: String, default: '' },
      linkedin: { type: String, default: '' },
      facebook: { type: String, default: '' },
      whatsapp: { type: String, default: '' },
    },
    passwordHash: { type: String, required: true },
    emailVerified: { type: Boolean, default: false },
    suspended: { type: Boolean, default: false },
    verifyToken: String,
    verifyTokenExpires: Date,
    resetToken: String,
    resetTokenExpires: Date,
    totpSecret: { type: String },
    totpEnabled: { type: Boolean, default: false },
    /** When true, user must change password on next login (e.g. temp password from school counsellor). */
    mustChangePassword: { type: Boolean, default: false },
    notificationPreferences: {
      emailApplicationUpdates: { type: Boolean, default: true },
      emailTrialReminder: { type: Boolean, default: true },
    },
    onboardingTutorialSeen: {
      student: { type: Boolean, default: false },
      university: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 });

export const User = mongoose.model('User', userSchema);
