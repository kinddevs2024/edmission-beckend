import mongoose from 'mongoose';

const universityProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    universityName: { type: String, required: true },
    tagline: String,
    establishedYear: Number,
    studentCount: Number,
    country: String,
    city: String,
    description: String,
    logoUrl: String,
    verified: { type: Boolean, default: false },
    onboardingCompleted: { type: Boolean, default: false },
    needsRecalculation: { type: Boolean, default: true },
  },
  { timestamps: true }
);

universityProfileSchema.index({ userId: 1 });
universityProfileSchema.index({ country: 1 });
universityProfileSchema.index({ city: 1 });
universityProfileSchema.index({ verified: 1 });

export const UniversityProfile = mongoose.model('UniversityProfile', universityProfileSchema);
