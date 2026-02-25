import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true },
    resource: String,
    resourceId: String,
    metadata: mongoose.Schema.Types.Mixed,
    ip: String,
  },
  { timestamps: true }
);

activityLogSchema.index({ userId: 1 });
activityLogSchema.index({ action: 1 });
activityLogSchema.index({ createdAt: 1 });

export const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
