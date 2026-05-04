import mongoose from 'mongoose';

const ROLES = [
  'student',
  'university',
  'university_multi_manager',
  'admin',
  'school_counsellor',
  'counsellor_coordinator',
  'manager',
] as const;
const LANGUAGES = ['en', 'ru', 'uz'] as const;

const userSchema = new mongoose.Schema(
  {
    role: { type: String, required: true, enum: ROLES },
    language: { type: String, enum: LANGUAGES, default: 'uz' },
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
    telegram: {
      chatId: {
        type: String,
        default: undefined,
        set: (value: string | null | undefined) => {
          const normalized = String(value ?? '').trim();
          return normalized || undefined;
        },
      },
      username: { type: String, default: '' },
      phone: { type: String, default: '' },
      linkedAt: { type: Date },
      linkCode: { type: String, default: '' },
      linkCodeExpiresAt: { type: Date },
      authCode: { type: String, default: '' },
      authCodeExpiresAt: { type: Date },
      authCodeAttempts: { type: Number, default: 0 },
      authState: { type: String, default: '' },
      pendingFullName: { type: String, default: '' },
    },
    passwordHash: { type: String, required: true },
    /** Google account subject (OpenID); set when user signs in with Google */
    googleSub: { type: String, sparse: true, unique: true },
    /** Yandex ID (numeric string from login.yandex.ru/info); set when user signs in with Yandex */
    yandexSub: { type: String, sparse: true, unique: true },
    yandexProfile: {
      login: { type: String, default: '' },
      psuid: { type: String, default: '' },
      firstName: { type: String, default: '' },
      lastName: { type: String, default: '' },
      displayName: { type: String, default: '' },
      realName: { type: String, default: '' },
      sex: { type: String, default: '' },
      birthday: { type: String, default: '' },
      defaultAvatarId: { type: String, default: '' },
      avatarUrl: { type: String, default: '' },
      defaultPhoneId: { type: String, default: '' },
      phone: { type: String, default: '' },
      emails: { type: [String], default: [] },
      raw: { type: mongoose.Schema.Types.Mixed },
      updatedAt: { type: Date },
    },
    emailVerified: { type: Boolean, default: false },
    suspended: { type: Boolean, default: false },
    verifyToken: String,
    verifyTokenExpires: Date,
    resetToken: String,
    resetTokenExpires: Date,
    passwordChangedAt: Date,
    tokenVersion: { type: Number, default: 0 },
    totpSecret: { type: String },
    totpEnabled: { type: Boolean, default: false },
    /** When true, user must change password on next login (e.g. temp password from school counsellor). */
    mustChangePassword: { type: Boolean, default: false },
    /**
     * false = account created via OAuth without a user-chosen password; must use /auth/set-password once.
     * true or undefined = normal email/password or password already set.
     */
    localPasswordConfigured: { type: Boolean },
    /**
     * Temporary/plain password for generated accounts only.
     * Visible to admins until the user updates their password, then cleared.
     */
    temporaryPlainPassword: { type: String, default: '' },
    temporaryPasswordGeneratedAt: { type: Date },
    notificationPreferences: {
      emailApplicationUpdates: { type: Boolean, default: true },
      emailTrialReminder: { type: Boolean, default: true },
      smsApplicationUpdates: { type: Boolean, default: false },
    },
    onboardingTutorialSeen: {
      student: { type: Boolean, default: false },
      university: { type: Boolean, default: false },
    },
    /** University account User ids this multi-manager may impersonate (after admin approval). */
    managedUniversityUserIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    /** Admin must set true before impersonation headers are accepted. */
    universityMultiManagerApproved: { type: Boolean, default: false },
    /** Expo push tokens for mobile app (Expo Push / FCM/APNs via Expo). */
    expoPushTokens: {
      type: [
        {
          token: { type: String, required: true },
          updatedAt: { type: Date, default: () => new Date() },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

userSchema.index(
  { 'telegram.chatId': 1 },
  {
    unique: true,
    partialFilterExpression: { 'telegram.chatId': { $type: 'string', $ne: '' } },
  }
);
userSchema.index({ 'telegram.linkCode': 1 }, { sparse: true });
userSchema.index(
  { phone: 1 },
  {
    unique: true,
    partialFilterExpression: { phone: { $type: 'string', $ne: '' } },
  }
);

export const User = mongoose.model('User', userSchema);
