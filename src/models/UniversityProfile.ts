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
    /** Public university rating shown to students. */
    rating: { type: Number, min: 0 },
    logoUrl: String,
    /** Optional large header image (like channel cover). */
    coverImageUrl: String,
    verified: { type: Boolean, default: false },
    /** Set when admin explicitly rejects verification; such universities are excluded from the queue */
    verificationRejectedAt: { type: Date },
    onboardingCompleted: { type: Boolean, default: false },
    needsRecalculation: { type: Boolean, default: true },
    /** Faculty codes offered by this university (from predefined catalog) */
    facultyCodes: [String],
    /** Per-category included items: { [categoryId]: string[] }. If missing for a category, all items from catalog are implied. */
    facultyItems: { type: mongoose.Schema.Types.Mixed, default: undefined },
    /** Country codes of students this university is targeting (e.g. 'UZ', 'KZ') */
    targetStudentCountries: [String],
    /** Minimum language level required (e.g. IELTS 6.5, TOEFL 90, C1) */
    minLanguageLevel: String,
    /** Minimum IELTS band (0–9). When set, students must upload an IELTS certificate before showing interest. */
    ieltsMinBand: { type: Number, min: 0, max: 9 },
    /** GPA requirement: 'scale' = 0–4 style value in gpaMinValue; 'percent' = percentage in gpaMinValue */
    gpaMinMode: { type: String, enum: ['scale', 'percent'] },
    gpaMinValue: Number,
    /** Tuition price in primary currency */
    tuitionPrice: Number,
  },
  { timestamps: true }
);

universityProfileSchema.index({ country: 1 });
universityProfileSchema.index({ city: 1 });
universityProfileSchema.index({ verified: 1 });
universityProfileSchema.index({ facultyCodes: 1 });
universityProfileSchema.index({ targetStudentCountries: 1 });

export const UniversityProfile = mongoose.model('UniversityProfile', universityProfileSchema);
