import mongoose from 'mongoose';

const recommendationSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityProfile', required: true },
    matchScore: { type: Number, required: true },
    breakdown: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

recommendationSchema.index({ studentId: 1, universityId: 1 }, { unique: true });
recommendationSchema.index({ studentId: 1 });
recommendationSchema.index({ universityId: 1 });

export const Recommendation = mongoose.model('Recommendation', recommendationSchema);
