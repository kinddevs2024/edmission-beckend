import mongoose from 'mongoose';

/** Single-document settings (key "global"). */
const systemSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    /** Require university account to be verified by admin before they can use the platform. */
    requireAccountConfirmation: { type: Boolean, default: false },
    /** Require user to verify email before they can login. */
    requireEmailVerification: { type: Boolean, default: false },
    /** When true, site is closed for maintenance; only admins can access. */
    maintenanceMode: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema);
