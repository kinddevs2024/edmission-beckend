import mongoose from 'mongoose';

const OFFER_STATUSES = ['pending', 'accepted', 'declined'] as const;

const offerSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityProfile', required: true },
    scholarshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Scholarship', default: null },
    coveragePercent: { type: Number, required: true },
    status: { type: String, default: 'pending', enum: OFFER_STATUSES },
    deadline: Date,
  },
  { timestamps: true }
);

offerSchema.index({ studentId: 1 });
offerSchema.index({ universityId: 1 });
offerSchema.index({ status: 1 });

export const Offer = mongoose.model('Offer', offerSchema);
