import mongoose from 'mongoose';

const universityDocumentSchema = new mongoose.Schema(
  {
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityProfile', required: true },
    documentType: { type: String, required: true },
    fileUrl: { type: String, required: true },
    status: String,
    reviewedBy: String,
    reviewedAt: Date,
  },
  { timestamps: true }
);

universityDocumentSchema.index({ universityId: 1 });
universityDocumentSchema.index({ status: 1 });

export const UniversityDocument = mongoose.model('UniversityDocument', universityDocumentSchema);
