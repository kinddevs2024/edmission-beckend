import mongoose from 'mongoose';

export const NOTIFICATION_TYPES = [
  'message',
  'offer',
  'offer_accepted',
  'offer_declined',
  'interest',
  'status_update',
  'new_university',
  'recommendation',
  'deadline_reminder',
  'profile_reminder',
  'verification',
  'system',
] as const;

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true, enum: NOTIFICATION_TYPES },
    title: String,
    body: String,
    referenceType: String,
    referenceId: String,
    metadata: mongoose.Schema.Types.Mixed,
    readAt: Date,
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1 });
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, type: 1 });

export const Notification = mongoose.model('Notification', notificationSchema);
