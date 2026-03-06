import mongoose from 'mongoose';

export type UniversityRequestStatus = 'pending' | 'approved' | 'rejected';

const universityVerificationRequestSchema = new mongoose.Schema(
  {
    universityCatalogId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityCatalog', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewedAt: Date,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

universityVerificationRequestSchema.index({ userId: 1 });
universityVerificationRequestSchema.index({ universityCatalogId: 1 });
universityVerificationRequestSchema.index({ status: 1 });
universityVerificationRequestSchema.index({ createdAt: -1 });

export const UniversityVerificationRequest = mongoose.model(
  'UniversityVerificationRequest',
  universityVerificationRequestSchema
);
