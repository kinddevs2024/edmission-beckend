import mongoose from 'mongoose';

const programSchema = new mongoose.Schema(
  {
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityProfile', required: true },
    name: { type: String, required: true },
    degreeLevel: { type: String, required: true },
    field: { type: String, required: true },
    durationYears: Number,
    tuitionFee: Number,
    language: String,
    entryRequirements: String,
  },
  { timestamps: true }
);

programSchema.index({ universityId: 1 });
programSchema.index({ degreeLevel: 1 });
programSchema.index({ field: 1 });

export const Program = mongoose.model('Program', programSchema);
