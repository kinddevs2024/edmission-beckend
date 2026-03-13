import mongoose from 'mongoose';

const STATUSES = ['interested', 'under_review', 'chat_opened', 'offer_sent', 'rejected', 'accepted'] as const;

/** Student interest in a catalog university (template). Routed to admin until university registers. */
const catalogInterestSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
    catalogUniversityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityCatalog', required: true },
    status: { type: String, default: 'interested', enum: STATUSES },
  },
  { timestamps: true }
);

catalogInterestSchema.index({ studentId: 1, catalogUniversityId: 1 }, { unique: true });
catalogInterestSchema.index({ studentId: 1 });
catalogInterestSchema.index({ catalogUniversityId: 1 });
catalogInterestSchema.index({ status: 1 });

export const CatalogInterest = mongoose.model('CatalogInterest', catalogInterestSchema);
