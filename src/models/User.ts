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
    /** Google account subject (OpenID); set when user signs in with Google */
    googleSub: { type: String, sparse: true, unique: true },
    /** Yandex ID (numeric string from login.yandex.ru/info); set when user signs in with Yandex */
    yandexSub: { type: String, sparse: true, unique: true },
    emailVerified: { type: Boolean, default: false },
    suspended: { type: Boolean, default: false },
    verifyToken: String,
    verifyTokenExpires: Date,
    resetToken: String,
    resetTokenExpires: Date,
    passwordChangedAt: Date,
    totpSecret: { type: String },
    totpEnabled: { type: Boolean, default: false },
    /** When true, user must change password on next login (e.g. temp password from school counsellor). */
    mustChangePassword: { type: Boolean, default: false },
    /**
     * false = account created via OAuth without a user-chosen password; must use /auth/set-password once.
     * true or undefined = normal email/password or password already set.
     */
    localPasswordConfigured: { type: Boolean },
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
