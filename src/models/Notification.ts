import mongoose from 'mongoose';

const NOTIFICATION_TYPES = ['offer', 'message', 'status_update'] as const;

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true, enum: NOTIFICATION_TYPES },
    title: String,
    body: String,
    referenceId: String,
    readAt: Date,
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1 });
notificationSchema.index({ readAt: 1 });
notificationSchema.index({ createdAt: 1 });

export const Notification = mongoose.model('Notification', notificationSchema);
