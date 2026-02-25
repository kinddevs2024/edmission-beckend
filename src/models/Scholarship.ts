import mongoose from 'mongoose';

const scholarshipSchema = new mongoose.Schema(
  {
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityProfile', required: true },
    name: { type: String, required: true },
    coveragePercent: { type: Number, required: true },
    maxSlots: { type: Number, required: true },
    remainingSlots: { type: Number, required: true },
    deadline: Date,
    eligibility: String,
  },
  { timestamps: true }
);

scholarshipSchema.index({ universityId: 1 });
scholarshipSchema.index({ deadline: 1 });

export const Scholarship = mongoose.model('Scholarship', scholarshipSchema);
