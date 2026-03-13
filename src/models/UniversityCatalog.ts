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
    /** Per-category included items: { [categoryId]: string[] }. If missing, all items from catalog are implied. */
    facultyItems: { type: mongoose.Schema.Types.Mixed, default: undefined },
    targetStudentCountries: [String],
    /** Set when a UniversityProfile is created from this catalog (on approval). Catalog is then hidden from students. */
    linkedUniversityProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityProfile' },
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
