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
    /** Faculty codes offered by this university (from predefined catalog) */
    facultyCodes: [String],
    /** Country codes of students this university is targeting (e.g. 'UZ', 'KZ') */
    targetStudentCountries: [String],
  },
  { timestamps: true }
);

universityProfileSchema.index({ userId: 1 });
universityProfileSchema.index({ country: 1 });
universityProfileSchema.index({ city: 1 });
universityProfileSchema.index({ verified: 1 });
universityProfileSchema.index({ facultyCodes: 1 });
universityProfileSchema.index({ targetStudentCountries: 1 });

export const UniversityProfile = mongoose.model('UniversityProfile', universityProfileSchema);
