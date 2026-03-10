import mongoose from 'mongoose';

const STATUSES = ['pending', 'accepted', 'rejected'] as const;

const schoolJoinRequestSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    counsellorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, default: 'pending', enum: STATUSES },
  },
  { timestamps: true }
);

schoolJoinRequestSchema.index({ studentId: 1, counsellorUserId: 1 }, { unique: true });
schoolJoinRequestSchema.index({ counsellorUserId: 1, status: 1 });
schoolJoinRequestSchema.index({ studentId: 1 });

export const SchoolJoinRequest = mongoose.model('SchoolJoinRequest', schoolJoinRequestSchema);
