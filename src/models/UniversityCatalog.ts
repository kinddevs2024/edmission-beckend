import mongoose from 'mongoose';

/** Catalog entry for a university (no user account). Shown on university selection page. */
const universityCatalogSchema = new mongoose.Schema(
  {
    universityName: { type: String, required: true },
    tagline: String,
    establishedYear: Number,
    studentCount: Number,
    country: String,
    city: String,
    description: String,
    logoUrl: String,
    facultyCodes: [String],
    targetStudentCountries: [String],
    /** Embedded programs to copy to UniversityProfile on approve */
    programs: [
      {
        name: String,
        degreeLevel: String,
        field: String,
        durationYears: Number,
        tuitionFee: Number,
        language: String,
        entryRequirements: String,
      },
    ],
    /** Embedded scholarships to copy on approve */
    scholarships: [
      {
        name: String,
        coveragePercent: Number,
        maxSlots: Number,
        deadline: Date,
        eligibility: String,
      },
    ],
  },
  { timestamps: true }
);

universityCatalogSchema.index({ universityName: 1 });
universityCatalogSchema.index({ country: 1 });
universityCatalogSchema.index({ city: 1 });

export const UniversityCatalog = mongoose.model('UniversityCatalog', universityCatalogSchema);
