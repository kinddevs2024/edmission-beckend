import mongoose from 'mongoose';

const STATUSES = ['interested', 'under_review', 'chat_opened', 'offer_sent', 'rejected', 'accepted'] as const;

const interestSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityProfile', required: true },
    status: { type: String, default: 'interested', enum: STATUSES },
  },
  { timestamps: true }
);

interestSchema.index({ studentId: 1, universityId: 1 }, { unique: true });
interestSchema.index({ studentId: 1 });
interestSchema.index({ universityId: 1 });
interestSchema.index({ status: 1 });

export const Interest = mongoose.model('Interest', interestSchema);
